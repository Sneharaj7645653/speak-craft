"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * @file        src/app/student/practice/_hooks/useSpeechSynthesis.ts
 * @layer       Presentation (client hook — text-to-speech)
 * @description
 *  Speaks the coach's replies aloud using the browser-native Web Speech
 *  synthesis API, preferring a natural female English voice. Purely client-side
 *  — no audio is uploaded or stored.
 *
 * @remarks
 *  Voices load asynchronously, so the preferred voice is (re)selected on the
 *  `voiceschanged` event. The utterance's language follows the chosen voice
 *  (defaulting to `en-US`). Voice availability varies by OS/browser; where no
 *  clearly-female voice is found we fall back to the platform's default English
 *  voice. Speech is always cancelled on unmount.
 */

/** Public shape returned by {@link useSpeechSynthesis}. */
export interface SpeechSynthesisHook {
  /** Whether the browser supports speech synthesis. */
  supported: boolean;
  /** Whether the coach is currently speaking. */
  speaking: boolean;
  /** Speaks `text` (Indian-English voice); `onDone` fires when it finishes/errors. */
  speak: (text: string, onDone?: () => void) => void;
  /** Immediately stops any in-progress speech. */
  cancel: () => void;
}

/** Names commonly shipped as natural female English voices across platforms. */
const FEMALE_VOICE_NAMES = [
  "samantha", // macOS / iOS — natural, Siri-like
  "ava", // macOS premium
  "allison",
  "susan",
  "victoria",
  "karen",
  "moira",
  "tessa",
  "fiona",
  "serena",
  "zira", // Windows
  "aria", // Windows / Edge — neural
  "jenny", // Edge neural
  "michelle",
  "sonia", // Edge en-GB neural
  "google us english",
  "google uk english female",
];

/** Markers that flag a higher-quality / neural voice. */
const QUALITY_MARKERS = /(neural|natural|premium|enhanced|siri|online|wavenet)/;

/**
 * Scores a voice for "natural female English", higher is better. Combines a
 * known-female-name / "female" match, quality markers, English locale, and a
 * small bonus for non-local (cloud) voices, which tend to sound smoother.
 */
function scoreVoice(voice: SpeechSynthesisVoice): number {
  const name = voice.name.toLowerCase();
  const lang = (voice.lang ?? "").toLowerCase();
  let score = 0;

  if (FEMALE_VOICE_NAMES.some((n) => name.includes(n))) score += 6;
  if (/\bfemale\b/.test(name)) score += 5;
  if (QUALITY_MARKERS.test(name)) score += 3;

  if (lang.startsWith("en-us")) score += 2;
  else if (lang.startsWith("en-gb")) score += 1.5;
  else if (lang.startsWith("en")) score += 0.5;
  else score -= 3; // non-English: strongly deprioritise

  if (!voice.localService) score += 0.5;
  return score;
}

/**
 * Chooses the most natural-sounding female English voice available.
 *
 * @param voices - The platform's available voices.
 * @returns The preferred voice, or `null` if none.
 */
function pickFemaleVoice(
  voices: SpeechSynthesisVoice[],
): SpeechSynthesisVoice | null {
  if (voices.length === 0) return null;
  let best: SpeechSynthesisVoice | null = null;
  let bestScore = -Infinity;
  for (const voice of voices) {
    const score = scoreVoice(voice);
    if (score > bestScore) {
      bestScore = score;
      best = voice;
    }
  }
  return best;
}

/**
 * React hook exposing natural female English text-to-speech.
 *
 * @returns A {@link SpeechSynthesisHook}.
 */
export function useSpeechSynthesis(): SpeechSynthesisHook {
  const [supported, setSupported] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const voiceRef = useRef<SpeechSynthesisVoice | null>(null);
  // Chrome silently stops synthesis after ~15s; a periodic resume() keeps longer
  // utterances (e.g. the full feedback) smooth instead of stuttering / cutting.
  const keepAliveRef = useRef<number | null>(null);

  const clearKeepAlive = useCallback((): void => {
    if (keepAliveRef.current !== null) {
      window.clearInterval(keepAliveRef.current);
      keepAliveRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    setSupported(true);

    const refresh = (): void => {
      voiceRef.current = pickFemaleVoice(window.speechSynthesis.getVoices());
    };
    refresh();
    window.speechSynthesis.addEventListener("voiceschanged", refresh);
    return () => {
      window.speechSynthesis.removeEventListener("voiceschanged", refresh);
    };
  }, []);

  const speak = useCallback((text: string, onDone?: () => void): void => {
    if (
      typeof window === "undefined" ||
      !("speechSynthesis" in window) ||
      text.trim().length === 0
    ) {
      onDone?.();
      return;
    }

    // Never overlap utterances.
    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    // Follow the chosen voice's language; default to en-US. No forced accent.
    utterance.lang = voiceRef.current?.lang ?? "en-US";
    if (voiceRef.current) utterance.voice = voiceRef.current;
    utterance.rate = 1;
    utterance.pitch = 1;

    utterance.onstart = () => setSpeaking(true);
    utterance.onend = () => {
      clearKeepAlive();
      setSpeaking(false);
      onDone?.();
    };
    utterance.onerror = () => {
      clearKeepAlive();
      setSpeaking(false);
      onDone?.();
    };

    window.speechSynthesis.speak(utterance);

    // Keep Chrome from stalling mid-utterance (the ~15s bug).
    clearKeepAlive();
    keepAliveRef.current = window.setInterval(() => {
      if (window.speechSynthesis.speaking) window.speechSynthesis.resume();
      else clearKeepAlive();
    }, 10_000);
  }, [clearKeepAlive]);

  const cancel = useCallback((): void => {
    clearKeepAlive();
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    setSpeaking(false);
  }, [clearKeepAlive]);

  // Stop any speech if the component unmounts.
  useEffect(() => cancel, [cancel]);

  return { supported, speaking, speak, cancel };
}
