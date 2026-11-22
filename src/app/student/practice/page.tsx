"use client";

import Link from "next/link";
import { Fragment, useCallback, useEffect, useRef, useState } from "react";

import { useSpeechRecognition } from "@/app/student/practice/_hooks/useSpeechRecognition";
import { useSpeechSynthesis } from "@/app/student/practice/_hooks/useSpeechSynthesis";
import { useHeartbeat } from "@/app/student/_hooks/useHeartbeat";
import { formatDuration } from "@/lib/format";
import type {
  StudentAssignmentsDto,
  StudentAssignmentViewDto,
} from "@/backend/assignment/assignment.dto";

/**
 * @file        src/app/student/practice/page.tsx
 * @layer       Presentation (client component — the conversational voice room)
 * @description
 *  A spoken, back-and-forth practice with Coach Anaya (#004CE5 light theme):
 *   1. Speech is captured in-browser (Web Speech API) — only text is sent.
 *   2. Each student turn is sent to the Edge coach in `converse` mode; the
 *      coach's short reply is streamed in AND spoken aloud in an Indian-English
 *      voice, then the student speaks again — a real conversation.
 *   3. Structured Sandwich-Method feedback is withheld until the student presses
 *      "End & get feedback", which sends the whole conversation in `evaluate`
 *      mode (this is what records the attempt for a formal assignment).
 *   4. Time spent counts toward the daily streak (background heartbeat).
 *
 * @remarks
 *  The coach is context-aware: `?assignmentId=…` scopes it to a formal task
 *  (fetched for display + attempt gating); otherwise it's free practice. Falls
 *  back to typed turns where the browser lacks speech recognition.
 */

/** Conversation lifecycle. */
type Phase =
  | "idle"
  | "listening"
  | "thinking"
  | "speaking"
  | "ready"
  | "evaluating"
  | "ended";

/** One turn in the conversation thread. */
interface Turn {
  role: "student" | "coach";
  content: string;
}

/** Result of a streamed coach call. */
interface StreamResult {
  ok: boolean;
  text: string;
  errorMessage?: string;
}

/** Strips markdown so the coach's spoken reply doesn't read out symbols. */
function cleanForSpeech(text: string): string {
  return text
    .replace(/[*#_`>]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Renders text with `**bold**` spans as <strong> and newlines preserved, with no
 * dangerouslySetInnerHTML (segments are plain text nodes — no XSS surface).
 */
function RichText({ text }: { readonly text: string }): React.JSX.Element {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return (
    <>
      {parts.map((part, index) =>
        part.startsWith("**") && part.endsWith("**") ? (
          <strong key={index} className="font-semibold text-slate-900">
            {part.slice(2, -2)}
          </strong>
        ) : (
          <Fragment key={index}>{part}</Fragment>
        ),
      )}
    </>
  );
}

/**
 * The conversational Voice Coach page.
 *
 * @returns The rendered practice room.
 */
export default function PracticePage(): React.JSX.Element {
  const speech = useSpeechRecognition();
  const synth = useSpeechSynthesis();
  // Time in this room counts toward the streak as FREE practice (the coach
  // records the formal ATTEMPT separately, so nothing is double-counted).
  const heartbeat = useHeartbeat();

  const [phase, setPhase] = useState<Phase>("idle");
  const [messages, setMessages] = useState<Turn[]>([]);
  const [streamingCoach, setStreamingCoach] = useState("");
  const [feedback, setFeedback] = useState("");
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [assignmentId, setAssignmentId] = useState<string | null>(null);
  const [assignment, setAssignment] = useState<StudentAssignmentViewDto | null>(null);

  const threadRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const messagesRef = useRef<Turn[]>([]);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  // Read the optional assignment id from the URL (no useSearchParams → no
  // Suspense boundary needed at build time).
  useEffect(() => {
    setAssignmentId(new URLSearchParams(window.location.search).get("assignmentId"));
  }, []);

  // Fetch assignment context (title / format / attempts left) when scoped.
  useEffect(() => {
    if (!assignmentId) {
      setAssignment(null);
      return;
    }
    let active = true;
    void (async () => {
      try {
        const res = await fetch("/api/student/assignments", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as StudentAssignmentsDto;
        if (active) {
          setAssignment(data.assignments.find((a) => a.id === assignmentId) ?? null);
        }
      } catch {
        /* best-effort; coaching works without context */
      }
    })();
    return () => {
      active = false;
    };
  }, [assignmentId]);

  // Auto-scroll the thread to the latest content.
  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight });
  }, [messages, streamingCoach]);

  // Tidy up on unmount: abort any stream, stop mic/voice/heartbeat.
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const attemptsBlocked = assignment !== null && !assignment.canAttempt;
  const label = assignment ? `Practising: ${assignment.title}` : "Free voice practice";

  /** POSTs a coaching request and streams the reply, invoking `onToken` live. */
  const streamCoach = useCallback(
    async (
      mode: "converse" | "evaluate",
      convo: Turn[],
      onToken: (soFar: string) => void,
    ): Promise<StreamResult> => {
      const controller = new AbortController();
      abortRef.current = controller;
      try {
        const res = await fetch("/api/coach/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode, assignmentId, messages: convo }),
          signal: controller.signal,
        });
        if (!res.ok || !res.body) {
          let message = "Coaching request failed. Please try again.";
          try {
            const payload = (await res.json()) as { error?: { message?: string } };
            if (payload.error?.message) message = payload.error.message;
          } catch {
            /* keep default */
          }
          return { ok: false, text: "", errorMessage: message };
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let text = "";
        // eslint-disable-next-line no-constant-condition
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          if (chunk) {
            text += chunk;
            onToken(text);
          }
        }
        return { ok: true, text };
      } catch (err) {
        if ((err as { name?: string }).name === "AbortError") {
          return { ok: false, text: "" };
        }
        return {
          ok: false,
          text: "",
          errorMessage: "Connection lost while talking to your coach. Please try again.",
        };
      } finally {
        abortRef.current = null;
      }
    },
    [assignmentId],
  );

  /** Begins (or resumes) capturing the student's next turn. */
  const beginListening = useCallback((): void => {
    setError(null);
    setTyped("");
    if (speech.supported) speech.start();
    setPhase("listening");
  }, [speech]);

  /** Starts a fresh conversation. */
  const startConversation = useCallback((): void => {
    setMessages([]);
    setFeedback("");
    setStreamingCoach("");
    setError(null);
    heartbeat.start(null, label);
    beginListening();
  }, [heartbeat, label, beginListening]);

  /** Reads the student's current turn text from speech (or the typed box). */
  const captureTurn = useCallback((): string => {
    if (speech.supported) {
      return `${speech.finalTranscript} ${speech.interimTranscript}`.trim();
    }
    return typed.trim();
  }, [speech, typed]);

  /** Sends the student's turn and streams + speaks the coach's conversational reply. */
  const sendTurn = useCallback(async (): Promise<void> => {
    const text = captureTurn();
    if (speech.listening) speech.stop();

    if (text.length < 2) {
      setError("I didn't quite catch that — please say a little more.");
      setPhase("ready");
      return;
    }

    const next: Turn[] = [...messagesRef.current, { role: "student", content: text }];
    setMessages(next);
    setTyped("");
    setStreamingCoach("");
    setPhase("thinking");

    const result = await streamCoach("converse", next, (soFar) =>
      setStreamingCoach(soFar),
    );

    if (result.ok && result.text.trim().length > 0) {
      const reply = result.text.trim();
      setMessages((prev) => [...prev, { role: "coach", content: reply }]);
      setStreamingCoach("");
      setPhase("speaking");
      synth.speak(cleanForSpeech(reply), () => setPhase("ready"));
    } else {
      setStreamingCoach("");
      if (result.errorMessage) setError(result.errorMessage);
      setPhase("ready");
    }
  }, [captureTurn, speech, streamCoach, synth]);

  /** Ends the conversation and streams the final Sandwich-Method feedback. */
  const endAndEvaluate = useCallback(async (): Promise<void> => {
    if (speech.listening) speech.stop();
    synth.cancel();
    heartbeat.stop();

    const convo = messagesRef.current;
    if (!convo.some((m) => m.role === "student")) {
      setError("Say a few words first, then I can give you feedback.");
      setPhase(convo.length > 0 ? "ready" : "idle");
      return;
    }

    setPhase("evaluating");
    setFeedback("");
    setError(null);

    const result = await streamCoach("evaluate", convo, (soFar) => setFeedback(soFar));
    if (!result.ok && result.errorMessage) setError(result.errorMessage);
    setPhase("ended");
  }, [speech, synth, heartbeat, streamCoach]);

  /** Resets the room for another go. */
  const practiceAgain = useCallback((): void => {
    synth.cancel();
    setMessages([]);
    setFeedback("");
    setStreamingCoach("");
    setError(null);
    setPhase("idle");
  }, [synth]);

  const conversationStarted = phase !== "idle";

  return (
    <div className="min-h-screen bg-surface-base">
      {/* Top bar */}
      <header className="border-b border-surface-border bg-white">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-6 py-4">
          <Link
            href="/student"
            aria-label="Back to dashboard"
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-brand-primary text-sm font-bold text-white"
          >
            SC
          </Link>
          <div className="flex-1">
            <h1 className="text-lg font-semibold tracking-tight text-slate-900">
              Talk with Coach Anaya
            </h1>
            <p className="text-xs text-slate-500">
              A spoken practice — chat back and forth, then get your feedback.
            </p>
          </div>
          <Link
            href="/student"
            className="text-sm font-medium text-brand-primary hover:underline"
          >
            ← Dashboard
          </Link>
        </div>
      </header>

      {/* Assignment context banner */}
      {assignment ? (
        <div className="border-b border-surface-border bg-brand-primary-subtle">
          <div className="mx-auto flex max-w-3xl flex-wrap items-center gap-x-3 gap-y-1 px-6 py-3 text-sm">
            <span className="font-semibold text-brand-primary">
              Assignment: {assignment.title}
            </span>
            <span className="text-slate-500">·</span>
            <span className="capitalize text-slate-600">{assignment.formatType}</span>
            <span className="text-slate-500">·</span>
            <span className={assignment.canAttempt ? "text-slate-600" : "text-red-600"}>
              {assignment.attemptsRemaining} of{" "}
              {assignment.attemptsUsed + assignment.attemptsRemaining} attempts left
            </span>
          </div>
        </div>
      ) : null}

      <main className="mx-auto max-w-3xl px-6 py-8">
        <section className="rounded-2xl border border-surface-border bg-white p-6 shadow-card">
          {/* Daily practice time vs the 30-minute cap (from the heartbeat). */}
          {heartbeat.latest ? (
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-surface-raised px-3 py-2 text-xs text-slate-500 ring-1 ring-surface-border">
              <span>
                ⏱ Practice today:{" "}
                <span className="font-medium text-slate-700">
                  {formatDuration(heartbeat.latest.dailyTotalSeconds)}
                </span>{" "}
                / {formatDuration(heartbeat.latest.dailyCapSeconds)}
              </span>
              <span>
                Daily goal {formatDuration(heartbeat.latest.dailyGoalSeconds)}
                {heartbeat.latest.goalMet ? " ✓" : ""}
              </span>
            </div>
          ) : null}

          {heartbeat.latest?.dailyCapReached ? (
            <div className="mb-4 rounded-lg border border-surface-border bg-surface-raised px-3 py-2 text-xs text-slate-600">
              You&apos;ve reached today&apos;s{" "}
              {formatDuration(heartbeat.latest.dailyCapSeconds)} practice limit — more
              time won&apos;t add to your streak, but you can finish this conversation
              and still get your feedback.
            </div>
          ) : null}

          {/* Conversation thread */}
          <div
            ref={threadRef}
            className="mb-4 max-h-[46vh] min-h-[16rem] space-y-3 overflow-y-auto rounded-xl bg-surface-raised p-4 ring-1 ring-surface-border"
          >
            {!conversationStarted && messages.length === 0 ? (
              <p className="py-10 text-center text-sm text-slate-400">
                {attemptsBlocked
                  ? "You've used all your attempts for this assignment. You can still practise freely from the dashboard."
                  : "Press “Start conversation” and just begin speaking. Coach Anaya will chat with you, then give feedback when you're done."}
              </p>
            ) : null}

            {messages.map((m, i) =>
              m.role === "student" ? (
                <div key={i} className="flex justify-end">
                  <p className="max-w-[80%] rounded-2xl rounded-br-sm bg-brand-primary px-3.5 py-2 text-sm text-white">
                    {m.content}
                  </p>
                </div>
              ) : (
                <div key={i} className="flex justify-start">
                  <p className="max-w-[80%] rounded-2xl rounded-bl-sm bg-white px-3.5 py-2 text-sm text-slate-800 ring-1 ring-surface-border">
                    {m.content}
                  </p>
                </div>
              ),
            )}

            {/* Live interim (student, while listening) */}
            {phase === "listening" && speech.interimTranscript ? (
              <div className="flex justify-end">
                <p className="max-w-[80%] rounded-2xl rounded-br-sm bg-brand-primary/60 px-3.5 py-2 text-sm text-white">
                  {speech.interimTranscript}
                </p>
              </div>
            ) : null}

            {/* Streaming coach reply */}
            {phase === "thinking" ? (
              <div className="flex justify-start">
                <p className="max-w-[80%] rounded-2xl rounded-bl-sm bg-white px-3.5 py-2 text-sm text-slate-800 ring-1 ring-surface-border">
                  {streamingCoach || (
                    <span className="text-slate-400">Coach Anaya is thinking…</span>
                  )}
                </p>
              </div>
            ) : null}
          </div>

          {/* Status line */}
          <p className="mb-3 text-center text-xs text-slate-500" aria-live="polite">
            {phase === "listening"
              ? "🎤 Listening… speak, then press Send."
              : phase === "thinking"
                ? "Coach is replying…"
                : phase === "speaking"
                  ? "🔊 Coach is speaking…"
                  : phase === "ready"
                    ? "Your turn — speak again, or end to get feedback."
                    : phase === "evaluating"
                      ? "Preparing your feedback…"
                      : phase === "ended"
                        ? "Here's your feedback below."
                        : "Ready when you are."}
          </p>

          {error ? (
            <p className="mb-3 rounded-lg border border-surface-border bg-surface-raised px-3 py-2 text-xs text-slate-500">
              {error}
            </p>
          ) : null}

          {/* Manual entry (browsers without speech recognition) */}
          {!speech.supported && (phase === "listening" || phase === "ready") ? (
            <textarea
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              rows={3}
              placeholder="Type what you'd say out loud…"
              className="mb-3 block w-full resize-y rounded-lg border border-surface-border bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-brand-primary"
            />
          ) : null}

          {/* Controls */}
          <div className="flex flex-wrap items-center gap-3">
            {phase === "idle" ? (
              <button
                type="button"
                onClick={startConversation}
                disabled={attemptsBlocked}
                className="flex-1 rounded-lg bg-brand-primary px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
              >
                Start conversation
              </button>
            ) : null}

            {phase === "listening" ? (
              <button
                type="button"
                onClick={() => void sendTurn()}
                className="flex-1 rounded-lg bg-brand-primary px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-primary-hover"
              >
                Send ▶
              </button>
            ) : null}

            {phase === "speaking" ? (
              <button
                type="button"
                onClick={() => {
                  synth.cancel();
                  setPhase("ready");
                }}
                className="flex-1 rounded-lg border border-surface-border bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition-colors hover:border-brand-primary hover:text-brand-primary"
              >
                Skip voice
              </button>
            ) : null}

            {phase === "ready" ? (
              <button
                type="button"
                onClick={beginListening}
                className="flex-1 rounded-lg bg-brand-primary px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-primary-hover"
              >
                🎤 Speak again
              </button>
            ) : null}

            {(phase === "listening" || phase === "ready" || phase === "speaking") &&
            messages.some((m) => m.role === "student") ? (
              <button
                type="button"
                onClick={() => void endAndEvaluate()}
                className="rounded-lg border border-surface-border bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition-colors hover:border-brand-primary hover:text-brand-primary"
              >
                End &amp; get feedback
              </button>
            ) : null}

            {phase === "ended" ? (
              <button
                type="button"
                onClick={practiceAgain}
                className="flex-1 rounded-lg bg-brand-primary px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-primary-hover"
              >
                Practise again
              </button>
            ) : null}
          </div>
        </section>

        {/* Final feedback */}
        {phase === "evaluating" || phase === "ended" ? (
          <section className="mt-6 rounded-2xl border border-surface-border bg-white p-6 shadow-card">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-base font-semibold text-slate-900">
                Your coaching feedback
              </h2>
              {phase === "ended" && feedback ? (
                <button
                  type="button"
                  onClick={() => synth.speak(cleanForSpeech(feedback))}
                  className="text-xs font-medium text-brand-primary hover:underline"
                >
                  🔊 Hear it
                </button>
              ) : null}
            </div>
            <div className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700">
              {feedback ? (
                <RichText text={feedback} />
              ) : (
                <span className="text-slate-400">Putting your feedback together…</span>
              )}
            </div>
          </section>
        ) : null}
      </main>
    </div>
  );
}
