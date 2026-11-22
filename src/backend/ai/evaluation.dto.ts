import type { AiProvider } from "@/backend/ai/evaluation.entity";
import type { ValidationResult } from "@/backend/user/user.dto";

/**
 * @file        src/backend/ai/evaluation.dto.ts
 * @layer       DTO Layer (API boundary contracts)
 * @description
 *  Validates the payload entering the coaching endpoint: the on-the-fly speech
 *  transcript, the optional current assignment id, and the optional attempt
 *  number. It is the anti-corruption boundary between an untrusted client
 *  transcript and the AI service — enforcing presence, type, and sane bounds
 *  before a single token is sent to an LLM.
 *
 * @remarks
 *  No audio ever reaches this layer; only text. Validators return a
 *  {@link ValidationResult} rather than throwing so the controller maps failures
 *  to `400` deterministically.
 */

/** RFC-4122 UUID shape (any version). */
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Minimum transcript length worth evaluating (guards empty / accidental sends). */
const MIN_TRANSCRIPT_LENGTH = 10;

/** Maximum transcript length accepted, bounding prompt size / cost. */
const MAX_TRANSCRIPT_LENGTH = 20_000;

/** Raw analyze payload as it arrives on the wire, before validation. */
export interface AnalyzeRequestRaw {
  transcript?: unknown;
  assignmentId?: unknown;
  attemptNumber?: unknown;
}

/**
 * A validated coaching request.
 *
 * @property transcript    - The trimmed speech transcript to evaluate.
 * @property assignmentId  - The assignment under attempt, or `null` (free practice).
 * @property attemptNumber - 1-based attempt index, or `null` if not applicable.
 */
export interface AnalyzeRequestDto {
  transcript: string;
  assignmentId: string | null;
  attemptNumber: number | null;
}

/**
 * The metadata returned to the client alongside (before) the token stream — not
 * used for the streamed body itself, but documents the contract for logging and
 * potential response headers.
 *
 * @property provider - The provider that ultimately served the stream.
 */
export interface EvaluationMetaDto {
  provider: AiProvider;
}

/**
 * Validates and normalises a raw analyze payload.
 *
 * @param input - The untrusted, parsed JSON body (shape unknown).
 * @returns A {@link ValidationResult}: the {@link AnalyzeRequestDto} on success,
 *          or the list of field errors on failure.
 */
export function validateAnalyzeRequest(
  input: AnalyzeRequestRaw | unknown,
): ValidationResult<AnalyzeRequestDto> {
  const errors: string[] = [];
  const body = (input ?? {}) as AnalyzeRequestRaw;

  // transcript (required)
  const transcript =
    typeof body.transcript === "string" ? body.transcript.trim() : "";
  if (transcript.length === 0) {
    errors.push("transcript is required.");
  } else if (transcript.length < MIN_TRANSCRIPT_LENGTH) {
    errors.push(
      `transcript is too short to evaluate (min ${MIN_TRANSCRIPT_LENGTH} characters).`,
    );
  } else if (transcript.length > MAX_TRANSCRIPT_LENGTH) {
    errors.push(
      `transcript exceeds the maximum of ${MAX_TRANSCRIPT_LENGTH} characters.`,
    );
  }

  // assignmentId (optional)
  let assignmentId: string | null = null;
  if (body.assignmentId !== undefined && body.assignmentId !== null) {
    if (
      typeof body.assignmentId !== "string" ||
      !UUID_PATTERN.test(body.assignmentId.trim())
    ) {
      errors.push("assignmentId, when provided, must be a valid UUID.");
    } else {
      assignmentId = body.assignmentId.trim();
    }
  }

  // attemptNumber (optional)
  let attemptNumber: number | null = null;
  if (body.attemptNumber !== undefined && body.attemptNumber !== null) {
    const n = Number(body.attemptNumber);
    if (!Number.isInteger(n) || n < 1) {
      errors.push("attemptNumber, when provided, must be a positive integer.");
    } else {
      attemptNumber = n;
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return { ok: true, value: { transcript, assignmentId, attemptNumber } };
}

// ─────────────────────────────────────────────────────────────────────────────
// Conversational coaching (multi-turn)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Coaching interaction mode:
 *  - `converse`  — the coach replies conversationally to the latest student turn
 *                  (short, spoken back-and-forth). No feedback, no persistence.
 *  - `evaluate`  — the practice is over; produce the structured Sandwich feedback
 *                  over the whole conversation, then persist + record the attempt.
 */
export type CoachMode = "converse" | "evaluate";

/** One turn in the practice conversation. */
export interface CoachMessageDto {
  role: "student" | "coach";
  content: string;
}

/** A validated conversational coaching request. */
export interface CoachRequestDto {
  mode: CoachMode;
  assignmentId: string | null;
  messages: CoachMessageDto[];
}

/** Max turns accepted in one conversation, bounding prompt size. */
const MAX_CONVERSATION_TURNS = 60;

/** Max total characters across the conversation, bounding cost. */
const MAX_CONVERSATION_CHARS = 24_000;

/** Max characters in a single turn. */
const MAX_TURN_CHARS = 4_000;

/**
 * Validates and normalises a conversational coaching request.
 *
 * @param input - The untrusted, parsed JSON body (shape unknown).
 * @returns A {@link ValidationResult}: the {@link CoachRequestDto} on success,
 *          or the list of field errors on failure.
 */
export function validateCoachRequest(
  input: unknown,
): ValidationResult<CoachRequestDto> {
  const errors: string[] = [];
  const body = (input ?? {}) as {
    mode?: unknown;
    assignmentId?: unknown;
    messages?: unknown;
  };

  const mode = body.mode;
  if (mode !== "converse" && mode !== "evaluate") {
    errors.push("mode must be 'converse' or 'evaluate'.");
  }

  let assignmentId: string | null = null;
  if (body.assignmentId !== undefined && body.assignmentId !== null) {
    if (
      typeof body.assignmentId !== "string" ||
      !UUID_PATTERN.test(body.assignmentId.trim())
    ) {
      errors.push("assignmentId, when provided, must be a valid UUID.");
    } else {
      assignmentId = body.assignmentId.trim();
    }
  }

  const messages: CoachMessageDto[] = [];
  const raw = Array.isArray(body.messages) ? body.messages : null;
  if (!raw || raw.length === 0) {
    errors.push("messages must be a non-empty array.");
  } else if (raw.length > MAX_CONVERSATION_TURNS) {
    errors.push(`conversation exceeds ${MAX_CONVERSATION_TURNS} turns.`);
  } else {
    let total = 0;
    for (const entry of raw) {
      const item = entry as { role?: unknown; content?: unknown };
      const role = item.role;
      const content = typeof item.content === "string" ? item.content.trim() : "";
      if (role !== "student" && role !== "coach") {
        errors.push("each message role must be 'student' or 'coach'.");
        break;
      }
      if (content.length === 0) {
        errors.push("each message must have non-empty content.");
        break;
      }
      total += content.length;
      messages.push({ role, content: content.slice(0, MAX_TURN_CHARS) });
    }
    if (total > MAX_CONVERSATION_CHARS) {
      errors.push("conversation exceeds the maximum length.");
    }
    if (!messages.some((m) => m.role === "student")) {
      errors.push("at least one student turn is required.");
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return { ok: true, value: { mode: mode as CoachMode, assignmentId, messages } };
}
