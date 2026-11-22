"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { HeartbeatResponseDto } from "@/backend/session/session.dto";
import { HEARTBEAT_INTERVAL_SECONDS } from "@/backend/student/practice-policy";

/**
 * @file        src/app/student/_hooks/useHeartbeat.ts
 * @layer       Presentation (client hook — the heartbeat engine)
 * @description
 *  Drives the fault-tolerant 30-second background ping while a speaking session
 *  is open. A stable, client-generated session UUID is minted on `start` and
 *  reused for every beat, so a beat lost to a network drop self-heals on the
 *  next tick (the server reconciles elapsed time from its own watermark) without
 *  ever double-counting.
 *
 * @remarks
 *  Resilience behaviours:
 *   - Network error on a beat → keep the interval alive and retry next tick.
 *   - `409` (retake guardrail) / `403` (ownership) → stop and surface the message.
 *   - Server signals `dailyCapReached` → auto-stop (further pings are pointless).
 *   - The interval is always cleared on stop and on unmount.
 */

/** Lifecycle status of the heartbeat engine. */
export type HeartbeatStatus = "idle" | "running" | "stopped";

/** Public state exposed to the UI. */
export interface HeartbeatState {
  status: HeartbeatStatus;
  /** The assignment being attempted, or `null` for free practice. */
  activeAssignmentId: string | null;
  /** A human label for the active session (assignment title or "Free practice"). */
  activeLabel: string | null;
  /** The most recent server response, or `null` before the first beat lands. */
  latest: HeartbeatResponseDto | null;
  /** The most recent error message, or `null`. */
  error: string | null;
}

/** Imperative controls returned alongside the state. */
export interface HeartbeatControls {
  /** Opens a session and begins pinging. No-op if one is already running. */
  start: (assignmentId: string | null, label: string) => void;
  /** Ends the current session and stops pinging. */
  stop: () => void;
}

const IDLE: HeartbeatState = {
  status: "idle",
  activeAssignmentId: null,
  activeLabel: null,
  latest: null,
  error: null,
};

/**
 * The heartbeat engine hook.
 *
 * @param onStopped - Optional callback fired whenever a running session stops
 *                    (used to refresh streak / assignment data).
 * @returns The current {@link HeartbeatState} and {@link HeartbeatControls}.
 */
export function useHeartbeat(onStopped?: () => void): HeartbeatState &
  HeartbeatControls {
  const [state, setState] = useState<HeartbeatState>(IDLE);

  const sessionIdRef = useRef<string | null>(null);
  const assignmentRef = useRef<string | null>(null);
  const intervalRef = useRef<number | null>(null);
  // Hold the latest onStopped in a ref so start/stop identities stay stable.
  const onStoppedRef = useRef<typeof onStopped>(onStopped);
  useEffect(() => {
    onStoppedRef.current = onStopped;
  }, [onStopped]);

  /** Clears the interval and marks the session stopped. */
  const stop = useCallback((): void => {
    if (intervalRef.current !== null) {
      window.clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    sessionIdRef.current = null;
    assignmentRef.current = null;
    setState((prev) =>
      prev.status === "running" ? { ...prev, status: "stopped" } : prev,
    );
    onStoppedRef.current?.();
  }, []);

  /** Sends a single heartbeat, applying the resilience rules. */
  const sendBeat = useCallback(async (): Promise<void> => {
    const sessionId = sessionIdRef.current;
    if (!sessionId) return;

    try {
      const response = await fetch("/api/student/heartbeat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, assignmentId: assignmentRef.current }),
      });
      const payload = (await response.json()) as
        | HeartbeatResponseDto
        | { error: { message: string } };

      if (!response.ok) {
        // 409 (retake limit) / 403 (ownership) carry a meaningful, user-facing
        // reason worth showing verbatim; then we stop pinging. Anything else is
        // an infrastructure hiccup — keep the technical detail in the console and
        // show the student calm, non-alarming copy while the interval retries.
        if (response.status === 409 || response.status === 403) {
          const message =
            "error" in payload ? payload.error.message : "You can't practise this right now.";
          setState((prev) => ({ ...prev, error: message }));
          stop();
          return;
        }
        console.warn("[heartbeat] sync failed:", payload);
        setState((prev) => ({
          ...prev,
          error: "Couldn't sync your practice time just now — we'll keep trying.",
        }));
        return;
      }

      const dto = payload as HeartbeatResponseDto;
      setState((prev) => ({ ...prev, latest: dto, error: null }));
      if (dto.dailyCapReached) stop();
    } catch {
      // Transient network failure — keep the interval and retry next tick.
      setState((prev) => ({
        ...prev,
        error: "Connection lost — retrying…",
      }));
    }
  }, [stop]);

  /** Opens a session and starts the interval. */
  const start = useCallback(
    (assignmentId: string | null, label: string): void => {
      if (intervalRef.current !== null) return; // already running

      sessionIdRef.current =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
      assignmentRef.current = assignmentId;

      setState({
        status: "running",
        activeAssignmentId: assignmentId,
        activeLabel: label,
        latest: null,
        error: null,
      });

      // Immediate start beat (creates the session), then every interval.
      void sendBeat();
      intervalRef.current = window.setInterval(() => {
        void sendBeat();
      }, HEARTBEAT_INTERVAL_SECONDS * 1000);
    },
    [sendBeat],
  );

  // Ensure the interval never outlives the component.
  useEffect(() => {
    return () => {
      if (intervalRef.current !== null) {
        window.clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, []);

  return { ...state, start, stop };
}
