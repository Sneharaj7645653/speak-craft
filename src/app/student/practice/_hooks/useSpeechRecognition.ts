"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * @file        src/app/student/practice/_hooks/useSpeechRecognition.ts
 * @layer       Presentation (client hook — audio capture)
 * @description
 *  Wraps the browser-native Web Speech API (`SpeechRecognition`) to capture the
 *  microphone and transcribe speech ON THE CLIENT, in real time. No audio ever
 *  leaves the browser — only the resulting text — which satisfies the
 *  audio-storage-safety rule (no .wav/.mp3 binaries are transmitted or stored).
 *
 * @remarks
 *  The Web Speech API is not part of the standard TypeScript DOM lib, so the
 *  minimal interfaces it relies on are declared here. Recognition is run in
 *  `continuous` + `interimResults` mode with the `en-IN` locale (Indian
 *  English), and auto-restarts if the engine ends while the user still intends
 *  to be listening (browsers stop after silence) — making capture resilient.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Minimal Web Speech API type surface (not shipped in lib.dom.d.ts).
// ─────────────────────────────────────────────────────────────────────────────

/** A single transcription hypothesis. */
interface SpeechRecognitionAlternative {
  readonly transcript: string;
  readonly confidence: number;
}

/** One recognition result (final or interim), a list of alternatives. */
interface SpeechRecognitionResult {
  readonly isFinal: boolean;
  readonly length: number;
  item(index: number): SpeechRecognitionAlternative;
  readonly [index: number]: SpeechRecognitionAlternative;
}

/** The list of results delivered on a recognition event. */
interface SpeechRecognitionResultList {
  readonly length: number;
  item(index: number): SpeechRecognitionResult;
  readonly [index: number]: SpeechRecognitionResult;
}

/** The `result` event payload. */
interface SpeechRecognitionEventLike extends Event {
  readonly resultIndex: number;
  readonly results: SpeechRecognitionResultList;
}

/** The `error` event payload. */
interface SpeechRecognitionErrorEventLike extends Event {
  readonly error: string;
  readonly message: string;
}

/** The recognition controller instance. */
interface SpeechRecognitionLike extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: ((event: Event) => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

/** Constructor shape for the vendor-prefixed and standard globals. */
type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  }
}

/** The public shape returned by {@link useSpeechRecognition}. */
export interface SpeechRecognitionHook {
  /** Whether the browser supports the Web Speech API. */
  supported: boolean;
  /** Whether the microphone is actively listening. */
  listening: boolean;
  /** Confirmed (final) transcript text accumulated so far. */
  finalTranscript: string;
  /** The current in-progress (interim) hypothesis, not yet finalised. */
  interimTranscript: string;
  /** The most recent recognition error message, or `null`. */
  error: string | null;
  /** Begins capture (clears any prior transcript). */
  start: () => void;
  /** Stops capture; the accumulated transcript is retained. */
  stop: () => void;
  /** Clears the transcript and error back to empty. */
  reset: () => void;
}

/**
 * Resolves the platform SpeechRecognition constructor, if available.
 *
 * @returns The constructor, or `null` when unsupported (e.g. Firefox, SSR).
 */
function getRecognitionCtor(): SpeechRecognitionConstructor | null {
  if (typeof window === "undefined") return null;
  return window.SpeechRecognition ?? window.webkitSpeechRecognition ?? null;
}

/**
 * React hook that manages live, client-side speech-to-text capture.
 *
 * @returns A {@link SpeechRecognitionHook}.
 */
export function useSpeechRecognition(): SpeechRecognitionHook {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [finalTranscript, setFinalTranscript] = useState("");
  const [interimTranscript, setInterimTranscript] = useState("");
  const [error, setError] = useState<string | null>(null);

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  // True while the user intends to keep listening (drives auto-restart on `end`).
  const shouldListenRef = useRef(false);

  // Detect support once, on mount (client only).
  useEffect(() => {
    setSupported(getRecognitionCtor() !== null);
  }, []);

  /** Lazily constructs and wires a recognition instance. */
  const ensureRecognition = useCallback((): SpeechRecognitionLike | null => {
    if (recognitionRef.current) return recognitionRef.current;

    const Ctor = getRecognitionCtor();
    if (!Ctor) return null;

    const recognition = new Ctor();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-IN"; // Indian English locale.
    recognition.maxAlternatives = 1;

    recognition.onresult = (event: SpeechRecognitionEventLike): void => {
      let interim = "";
      let finalizedChunk = "";
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        if (!result) continue;
        const alternative = result[0];
        if (!alternative) continue;
        if (result.isFinal) {
          finalizedChunk += alternative.transcript;
        } else {
          interim += alternative.transcript;
        }
      }
      if (finalizedChunk) {
        setFinalTranscript((prev) =>
          `${prev}${prev && !prev.endsWith(" ") ? " " : ""}${finalizedChunk.trim()}`.trimStart(),
        );
      }
      setInterimTranscript(interim);
    };

    recognition.onerror = (event: SpeechRecognitionErrorEventLike): void => {
      // 'no-speech' / 'aborted' are benign; surface the rest.
      if (event.error === "no-speech" || event.error === "aborted") return;
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        setError("Microphone permission was denied. Please allow mic access and retry.");
      } else {
        setError(`Speech recognition error: ${event.error}`);
      }
    };

    recognition.onend = (): void => {
      // Browsers stop after a pause; restart if the user still wants to listen.
      if (shouldListenRef.current && recognitionRef.current) {
        try {
          recognitionRef.current.start();
          return;
        } catch {
          // Fall through to marking stopped if restart is rejected.
        }
      }
      setListening(false);
      setInterimTranscript("");
    };

    recognitionRef.current = recognition;
    return recognition;
  }, []);

  const start = useCallback((): void => {
    const recognition = ensureRecognition();
    if (!recognition) {
      setError("Your browser does not support live speech recognition.");
      return;
    }
    setError(null);
    setFinalTranscript("");
    setInterimTranscript("");
    shouldListenRef.current = true;
    try {
      recognition.start();
      setListening(true);
    } catch {
      // start() throws if already started — treat as already listening.
      setListening(true);
    }
  }, [ensureRecognition]);

  const stop = useCallback((): void => {
    shouldListenRef.current = false;
    recognitionRef.current?.stop();
    setListening(false);
    setInterimTranscript("");
  }, []);

  const reset = useCallback((): void => {
    setFinalTranscript("");
    setInterimTranscript("");
    setError(null);
  }, []);

  // Clean up on unmount.
  useEffect(() => {
    return () => {
      shouldListenRef.current = false;
      recognitionRef.current?.abort();
      recognitionRef.current = null;
    };
  }, []);

  return {
    supported,
    listening,
    finalTranscript,
    interimTranscript,
    error,
    start,
    stop,
    reset,
  };
}
