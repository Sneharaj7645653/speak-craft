import "server-only";

import Groq from "groq-sdk";
import { GoogleGenAI } from "@google/genai";

import { aiEnv } from "@/lib/env";
import { AssignmentRepository } from "@/backend/assignment/assignment.repository";
import { EvaluationRepository } from "@/backend/ai/evaluation.repository";
import { StudentService } from "@/backend/student/student.service";
import type { CoachMessageDto, CoachMode } from "@/backend/ai/evaluation.dto";
import type { AiProvider } from "@/backend/ai/evaluation.entity";

/**
 * @file        src/backend/ai/ai-coach.service.ts
 * @layer       Service Layer (Business Logic)
 * @description
 *  The conversational, multi-LLM coaching engine. It supports two modes over the
 *  same failover-streaming machinery:
 *
 *   - `converse` — given the conversation so far, stream the coach's next SHORT,
 *     spoken-style reply (a natural back-and-forth). Nothing is persisted.
 *   - `evaluate` — the session is over; stream the structured Sandwich-Method
 *     feedback over the WHOLE conversation, then record the attempt (for a formal
 *     assignment) and persist the evaluation.
 *
 *  Both modes:
 *   - speak in an encouraging Indian-English persona ("Coach Anaya"),
 *   - are aware of whether this is FREE practice or a formal ASSIGNMENT, and
 *   - use Groq (Llama 3) as the primary provider with an instant Gemini fallback.
 *
 * @remarks
 *  Everything is `fetch`-based and Edge-runtime compatible. The service never
 *  sees or stores audio — only the client-produced text turns.
 */

/** Groq model — a current Llama 3 family model for ultra-low-latency streaming. */
const GROQ_MODEL = "llama-3.3-70b-versatile";

/** Gemini fallback model — fast, widely-available, Edge-friendly. */
const GEMINI_MODEL = "gemini-2.0-flash";

const TEMPERATURE = 0.6;
const MAX_OUTPUT_TOKENS = 1024;
const PROVIDER_TIMEOUT_MS = 25_000;

/** Hedge / filler tokens used by the delivery-proxy scorer. */
const FILLER_TERMS: readonly string[] = [
  "um",
  "uh",
  "uhm",
  "er",
  "erm",
  "ah",
  "hmm",
  "you know",
  "i mean",
  "kind of",
  "sort of",
  "basically",
  "actually",
  "literally",
];

/** A provider-neutral chat turn (as the LLMs expect it). */
interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

/** The fully-resolved input the coaching engine operates on. */
export interface CoachStreamInput {
  /** The verified student id (never trusted from the request body). */
  studentId: string;
  /** Interaction mode. */
  mode: CoachMode;
  /** The assignment under practice, or `null` for free practice. */
  assignmentId: string | null;
  /** The conversation so far (student + coach turns). */
  messages: CoachMessageDto[];
}

/** Lightweight, transparent delivery metrics derived from the student's speech. */
export interface DeliveryMetrics {
  wordCount: number;
  fillerWordCount: number;
  score: number;
}

/** Optional assignment context used to tailor the coaching. */
interface AssignmentContext {
  title: string;
  format: string;
  /** The instructor's brief / instructions for the task (may be empty). */
  description: string;
}

/** Cap on how much of the instructor brief we inject into the prompt. */
const MAX_BRIEF_CHARS = 1500;

export class AiCoachService {
  private readonly evaluations: EvaluationRepository;
  private readonly assignments: AssignmentRepository;
  private readonly students: StudentService;
  private readonly groqApiKey: string | undefined;
  private readonly geminiApiKey: string | undefined;

  /**
   * @param evaluationRepository - Persists the terminal evaluation record.
   * @param assignmentRepository - Resolves optional assignment context.
   * @param studentService       - Owns the retake guardrail + attempt ledger.
   */
  constructor(
    evaluationRepository: EvaluationRepository = new EvaluationRepository(),
    assignmentRepository: AssignmentRepository = new AssignmentRepository(),
    studentService: StudentService = new StudentService(),
  ) {
    this.evaluations = evaluationRepository;
    this.assignments = assignmentRepository;
    this.students = studentService;
    this.groqApiKey = aiEnv.groqApiKey();
    this.geminiApiKey = aiEnv.geminiApiKey();
  }

  /**
   * Whether at least one provider is configured. The controller checks this
   * before opening the stream to return a clean `503` if entirely unconfigured.
   *
   * @returns `true` if Groq and/or Gemini credentials are present.
   */
  isConfigured(): boolean {
    return Boolean(this.groqApiKey || this.geminiApiKey);
  }

  /**
   * Pre-stream retake-guardrail check for a formal EVALUATE. No-op for free
   * practice or for `converse` turns (conversation is unlimited).
   *
   * @param input - The resolved {@link CoachStreamInput}.
   * @throws {RetakeLimitExceededError} When no attempts remain for the assignment.
   */
  async assertAttemptAllowed(input: CoachStreamInput): Promise<void> {
    if (input.mode !== "evaluate") return;
    if (input.assignmentId) {
      await this.students.assertAssignmentAssigned(
        input.studentId,
        input.assignmentId,
      );
    }
    await this.students.assertAttemptAllowed(input.studentId, input.assignmentId);
  }

  /**
   * Builds a byte stream of coaching text for the given mode. On `evaluate`, once
   * the stream terminates it records the attempt and persists the evaluation
   * (awaited before close so the writes complete within the request lifetime).
   *
   * @param input - The resolved {@link CoachStreamInput}.
   * @returns A byte stream suitable for a chunked HTTP response body.
   */
  createCoachStream(
    input: CoachStreamInput,
    externalSignal?: AbortSignal,
  ): ReadableStream<Uint8Array> {
    const encoder = new TextEncoder();
    const service = this;
    const state = { provider: "groq" as AiProvider };
    const collected: string[] = [];

    return new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          const context = await service.resolveAssignmentContext(input.assignmentId);
          const system =
            input.mode === "evaluate"
              ? service.buildEvaluationSystemPrompt(context)
              : service.buildConversationSystemPrompt(context);
          const turns =
            input.mode === "evaluate"
              ? [
                  {
                    role: "user" as const,
                    content: service.buildEvaluationUserContent(context, input.messages),
                  },
                ]
              : service.toChatTurns(input.messages);

          for await (const token of service.streamWithFailover(
            system,
            turns,
            state,
            externalSignal,
          )) {
            collected.push(token);
            controller.enqueue(encoder.encode(token));
          }
        } catch (error) {
          // eslint-disable-next-line no-console
          console.error("[AiCoachService] streaming failed:", error);
          const apology =
            input.mode === "evaluate"
              ? "\n\nSorry, I couldn't put your feedback together just now. Please try again in a moment."
              : "\n\nSorry, I lost you for a second there — could you say that once more?";
          collected.push(apology);
          controller.enqueue(encoder.encode(apology));
        } finally {
          // Only a completed EVALUATE counts as an attempt and is persisted.
          if (input.mode === "evaluate") {
            await service
              .finalizeRun(input, collected.join(""), state.provider)
              // eslint-disable-next-line no-console
              .catch((err) => console.error("[AiCoachService] finalization failed:", err));
          }
          controller.close();
        }
      },
    });
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Prompt construction
  // ───────────────────────────────────────────────────────────────────────────

  /** Shared persona + context preamble used by both prompts. */
  private personaPreamble(context: AssignmentContext | null): string {
    let scope: string;
    if (context) {
      const brief = context.description.trim();
      scope =
        `This is a FORMAL assignment the instructor set — a "${context.format}" titled "${context.title}". ` +
        (brief
          ? `The instructor's brief / instructions are: "${brief}". Keep the practice focused on this brief, and prompt the student on parts of it they haven't covered.`
          : "The instructor gave no extra written instructions, so focus on the title and format.");
    } else {
      scope =
        "This is a FREE, open practice session the student chose themselves. Any topic is fine.";
    }
    return [
      "You are 'Coach Anaya', a warm, encouraging but straight-talking public-speaking coach.",
      "Speak in natural, everyday English — clear and conversational, never stiff or formal.",
      "Be supportive and calm to keep anxiety low, but honest and specific. No slang, no put-on accent.",
      scope,
    ].join(" ");
  }

  /**
   * System prompt for a CONVERSATION turn: short, spoken, back-and-forth. The
   * coach must NOT give structured feedback here — it keeps the student talking.
   *
   * @param context - Assignment context, or `null` for free practice.
   * @returns The system prompt.
   */
  buildConversationSystemPrompt(context: AssignmentContext | null): string {
    return [
      this.personaPreamble(context),
      "",
      "You are having a live, spoken conversation. Your reply will be READ ALOUD, so:",
      "- Keep it SHORT: 1–3 natural sentences. No lists, no headings, no markdown, no emojis.",
      "- React warmly to what the student just said, then ask ONE simple follow-up question",
      "  or gently invite them to continue / expand — the goal is to keep them speaking.",
      "- Do NOT give structured feedback, scores, or a Praise/Critique summary yet; that comes",
      "  only at the end when the student finishes. Just converse naturally for now.",
      "- If the student seems finished, encourage one more thought or let them know they can",
      "  end whenever they're ready to get their feedback.",
    ].join("\n");
  }

  /**
   * System prompt for the FINAL evaluation over the whole conversation.
   *
   * @param context - Assignment context, or `null` for free practice.
   * @returns The system prompt.
   */
  buildEvaluationSystemPrompt(context: AssignmentContext | null): string {
    return [
      this.personaPreamble(context),
      "",
      "The practice session is now OVER. Give concise, direct, genuinely useful feedback on the",
      "student's SPEAKING, using the Sandwich Method with these exact headings:",
      "",
      "**Praise**",
      "1–2 sentences on what they genuinely did well (structure, a clear point, a good example).",
      "Specific, not generic flattery.",
      "",
      "**Constructive Critique**",
      "1 or 2 specific issues in wording, delivery, pacing, or clarity. Be direct and practical —",
      "do NOT sugar-coat, and do NOT be melodramatic or over-encouraging.",
      "For at least one point, quote what they actually said and show a sharper version, in EXACTLY",
      'this form:  You said: "…" — try: "…".',
      "",
      "**Motivation**",
      "ONE short, sincere line of encouragement. No long pep-talk, no drama.",
      "",
      "Keep the whole thing tight and to the point. Base everything strictly on what the student" +
        (context
          ? " actually said and how well it addressed the assignment brief."
          : " actually said."),
    ].join("\n");
  }

  /**
   * Builds the single user message for the evaluation call: the full transcript
   * of the conversation plus the instruction to evaluate the student.
   *
   * @param context  - Assignment context, or `null`.
   * @param messages - The whole conversation.
   * @returns The user content string.
   */
  buildEvaluationUserContent(
    context: AssignmentContext | null,
    messages: CoachMessageDto[],
  ): string {
    const transcript = messages
      .map((m) => `${m.role === "student" ? "Student" : "Coach"}: ${m.content}`)
      .join("\n");
    return [
      context
        ? `Assignment: "${context.title}" (${context.format}).`
        : "Free practice session.",
      "",
      "Here is the full practice conversation:",
      '"""',
      transcript,
      '"""',
      "",
      "Now give the student their closing Sandwich-Method feedback on their speaking.",
    ].join("\n");
  }

  /** Maps client conversation turns to provider-neutral chat turns. */
  private toChatTurns(messages: CoachMessageDto[]): ChatTurn[] {
    return messages.map((m) => ({
      role: m.role === "student" ? "user" : "assistant",
      content: m.content,
    }));
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Failover streaming loop
  // ───────────────────────────────────────────────────────────────────────────

  /** Combines browser cancellation and the provider timeout into one signal. */
  private combineAbortSignals(
    first: AbortSignal,
    second: AbortSignal,
  ): AbortSignal {
    const controller = new AbortController();
    const forward = (signal: AbortSignal): void => {
      if (signal.aborted) {
        controller.abort(signal.reason);
        return;
      }
      signal.addEventListener(
        "abort",
        () => controller.abort(signal.reason),
        { once: true },
      );
    };
    forward(first);
    forward(second);
    return controller.signal;
  }

  /**
   * Attempts Groq first; if Groq fails BEFORE emitting a token, switches to
   * Gemini seamlessly. A mid-stream Groq failure appends a brief note instead of
   * restarting (the client already has the partial output).
   */
  private async *streamWithFailover(
    system: string,
    turns: ChatTurn[],
    state: { provider: AiProvider },
    externalSignal?: AbortSignal,
  ): AsyncGenerator<string, void, void> {
    let emitted = false;
    const groqTimeout = AbortSignal.timeout(PROVIDER_TIMEOUT_MS);
    const groqSignal = externalSignal
      ? this.combineAbortSignals(externalSignal, groqTimeout)
      : groqTimeout;
    try {
      state.provider = "groq";
      for await (const token of this.streamFromGroq(system, turns, groqSignal)) {
        emitted = true;
        yield token;
      }
      return;
    } catch (groqError) {
      // eslint-disable-next-line no-console
      console.error("[AiCoachService] Groq failed, evaluating fallback:", groqError);
      if (externalSignal?.aborted) return;
      if (emitted) {
        yield " …";
        return;
      }
    }

    const geminiTimeout = AbortSignal.timeout(PROVIDER_TIMEOUT_MS);
    const geminiSignal = externalSignal
      ? this.combineAbortSignals(externalSignal, geminiTimeout)
      : geminiTimeout;
    state.provider = "gemini";
    yield* this.streamFromGemini(system, turns, geminiSignal);
  }

  /**
   * Streams a chat completion from Groq (primary).
   *
   * @throws {Error} When the key is absent or Groq errors (drives failover).
   */
  private async *streamFromGroq(
    system: string,
    turns: ChatTurn[],
    signal?: AbortSignal,
  ): AsyncGenerator<string, void, void> {
    if (!this.groqApiKey) {
      throw new Error("GROQ_API_KEY is not configured.");
    }

    const groq = new Groq({
      apiKey: this.groqApiKey,
      timeout: PROVIDER_TIMEOUT_MS,
    });
    const completion = await groq.chat.completions.create({
      model: GROQ_MODEL,
      messages: [{ role: "system", content: system }, ...turns],
      stream: true,
      temperature: TEMPERATURE,
      max_tokens: MAX_OUTPUT_TOKENS,
    }, { signal });

    for await (const chunk of completion) {
      const token = chunk.choices[0]?.delta?.content ?? "";
      if (token) yield token;
    }
  }

  /**
   * Streams generated content from Google Gemini (fallback).
   *
   * @throws {Error} When the key is absent or Gemini errors.
   */
  private async *streamFromGemini(
    system: string,
    turns: ChatTurn[],
    signal?: AbortSignal,
  ): AsyncGenerator<string, void, void> {
    if (!this.geminiApiKey) {
      throw new Error("GEMINI_API_KEY is not configured.");
    }

    const ai = new GoogleGenAI({ apiKey: this.geminiApiKey });
    const stream = await ai.models.generateContentStream({
      model: GEMINI_MODEL,
      contents: turns.map((t) => ({
        role: t.role === "assistant" ? "model" : "user",
        parts: [{ text: t.content }],
      })),
      config: {
        systemInstruction: system,
        temperature: TEMPERATURE,
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        abortSignal: signal,
      },
    });

    for await (const chunk of stream) {
      const token = chunk.text ?? "";
      if (token) yield token;
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Scoring, context, persistence
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Computes a transparent, deterministic delivery-proxy score from the
   * student's spoken text (filler density + length). Not a replacement for the
   * qualitative coaching — it gives a trackable number for dashboards.
   *
   * @param transcript - The student's spoken text.
   * @returns The {@link DeliveryMetrics}.
   */
  computeMetrics(transcript: string): DeliveryMetrics {
    const normalized = transcript.toLowerCase();
    const words = normalized.split(/\s+/).filter((w) => w.length > 0);
    const wordCount = words.length;

    let fillerWordCount = 0;
    for (const term of FILLER_TERMS) {
      const pattern = new RegExp(
        `(?:^|\\s)${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=\\s|$|[.,!?;:])`,
        "g",
      );
      const matches = normalized.match(pattern);
      if (matches) fillerWordCount += matches.length;
    }

    const fillerRatio = wordCount > 0 ? fillerWordCount / wordCount : 0;
    const fillerPenalty = Math.min(35, Math.round(fillerRatio * 300));
    const lengthPenalty =
      wordCount >= 120 ? 0 : Math.min(25, Math.round(((120 - wordCount) / 120) * 25));
    const score = Math.max(55, Math.min(100, 100 - fillerPenalty - lengthPenalty));

    return { wordCount, fillerWordCount, score };
  }

  /**
   * Resolves optional assignment context for prompt tailoring. Best-effort: any
   * failure returns `null` and coaching proceeds as free practice.
   */
  private async resolveAssignmentContext(
    assignmentId: string | null,
  ): Promise<AssignmentContext | null> {
    if (!assignmentId) return null;
    try {
      const assignment = await this.assignments.findById(assignmentId);
      if (!assignment) return null;
      return {
        title: assignment.title,
        format: assignment.format_type,
        description: (assignment.description ?? "").slice(0, MAX_BRIEF_CHARS),
      };
    } catch {
      return null;
    }
  }

  /** The student's spoken words across the conversation (for scoring + storage). */
  private studentTranscript(messages: CoachMessageDto[]): string {
    return messages
      .filter((m) => m.role === "student")
      .map((m) => m.content)
      .join(" ")
      .trim();
  }

  /**
   * Finalises an EVALUATE run: records the formal attempt (+ completion) and
   * persists the evaluation. A run that produced no usable feedback records
   * nothing, so a total failure never consumes an attempt.
   */
  private async finalizeRun(
    input: CoachStreamInput,
    feedback: string,
    provider: AiProvider,
  ): Promise<void> {
    if (feedback.trim().length === 0) return;

    const transcript = this.studentTranscript(input.messages);
    if (transcript.length === 0) return;

    let attemptNumber: number | null = null;
    if (input.assignmentId) {
      try {
        attemptNumber = await this.students.finalizeCoachedAttempt(
          input.studentId,
          input.assignmentId,
          new Date(),
        );
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error("[AiCoachService] attempt finalization failed:", err);
      }
    }

    const metrics = this.computeMetrics(transcript);
    await this.evaluations.saveEvaluation({
      student_id: input.studentId,
      assignment_id: input.assignmentId,
      attempt_number: attemptNumber,
      transcript,
      feedback,
      score: metrics.score,
      provider,
      word_count: metrics.wordCount,
      filler_word_count: metrics.fillerWordCount,
    });
  }
}
