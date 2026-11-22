"use client";

import { formatDuration } from "@/lib/format";
import { HEARTBEAT_INTERVAL_SECONDS } from "@/backend/student/practice-policy";
import type { HeartbeatState } from "@/app/student/_hooks/useHeartbeat";

/**
 * @file        src/app/student/_components/PracticeConsole.tsx
 * @layer       Presentation (client component — presentational)
 * @description
 *  The active-session console. Presents the live state of the heartbeat engine:
 *  the running session, credited daily total against the goal and governor
 *  ceiling, connection resilience feedback, and the start/stop controls. All
 *  timing logic lives in the {@link useHeartbeat} hook; this component only
 *  renders the state it is handed.
 *
 * @param state         - Current heartbeat engine state.
 * @param onStartFree   - Starts a free-practice session.
 * @param onStop        - Ends the active session.
 */
export function PracticeConsole({
  state,
  onStartFree,
  onStop,
}: {
  readonly state: HeartbeatState;
  readonly onStartFree: () => void;
  readonly onStop: () => void;
}): React.JSX.Element {
  const running = state.status === "running";
  const latest = state.latest;

  const dailyTotal = latest?.dailyTotalSeconds ?? 0;
  const goal = latest?.dailyGoalSeconds ?? 0;
  const cap = latest?.dailyCapSeconds ?? 0;
  const capReached = latest?.dailyCapReached ?? false;

  return (
    <section className="rounded-2xl border border-surface-border bg-white p-6 shadow-card">
      <header className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-slate-900">
            Practice session
          </h2>
          <p className="mt-0.5 text-sm text-slate-500">
            {running
              ? state.activeLabel ?? "Practicing…"
              : "Start a session — your time syncs automatically."}
          </p>
        </div>
        {running ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-primary-subtle px-3 py-1 text-xs font-medium text-brand-primary">
            <span className="h-2 w-2 animate-pulse rounded-full bg-brand-primary" />
            Live
          </span>
        ) : null}
      </header>

      {running ? (
        <div className="space-y-4">
          {/* Session timer */}
          <div className="rounded-xl bg-surface-raised p-5 text-center ring-1 ring-surface-border">
            <p className="text-xs uppercase tracking-wide text-slate-500">
              This session
            </p>
            <p className="mt-1 text-4xl font-bold tabular-nums text-slate-900">
              {formatDuration(latest?.sessionSeconds ?? 0)}
            </p>
            <p className="mt-1 text-xs text-slate-400">
              Syncing every {HEARTBEAT_INTERVAL_SECONDS}s
              {latest?.attemptNumber ? ` · attempt #${latest.attemptNumber}` : ""}
            </p>
          </div>

          {/* Daily total vs goal / cap */}
          <div>
            <div className="mb-1.5 flex items-center justify-between text-sm">
              <span className="font-medium text-slate-700">Today total</span>
              <span className="tabular-nums text-slate-500">
                {formatDuration(dailyTotal)} / {formatDuration(cap)}
              </span>
            </div>
            <div className="relative h-2.5 w-full overflow-hidden rounded-full bg-surface-raised ring-1 ring-surface-border">
              <div
                className="h-full rounded-full bg-brand-primary transition-all"
                style={{
                  width: `${cap > 0 ? Math.min(100, (dailyTotal / cap) * 100) : 0}%`,
                }}
              />
            </div>
            <p className="mt-1.5 text-xs text-slate-400">
              Goal: {formatDuration(goal)} cumulative ·{" "}
              {latest?.goalMet ? "goal met today ✓" : "keep going"}
            </p>
          </div>

          {state.error ? (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
              {state.error}
            </p>
          ) : null}

          <button
            type="button"
            onClick={onStop}
            className="w-full rounded-lg border border-surface-border bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition-colors hover:border-brand-primary hover:text-brand-primary"
          >
            End session
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {state.status === "stopped" && capReached ? (
            <div className="rounded-lg border border-brand-primary/30 bg-brand-primary-subtle px-4 py-3 text-sm text-brand-primary">
              You&apos;ve reached today&apos;s {formatDuration(cap)} practice
              ceiling. Come back tomorrow to keep your streak going!
            </div>
          ) : state.status === "stopped" ? (
            <div className="rounded-lg border border-surface-border bg-surface-raised px-4 py-3 text-sm text-slate-600">
              Session ended. Great work — start another anytime.
            </div>
          ) : null}

          {state.error && state.status !== "running" ? (
            <p className="rounded-lg border border-surface-border bg-surface-raised px-3 py-2 text-sm text-slate-500">
              {state.error}
            </p>
          ) : null}

          <button
            type="button"
            onClick={onStartFree}
            className="w-full rounded-lg bg-brand-primary px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-primary-hover"
          >
            Start free practice
          </button>
        </div>
      )}
    </section>
  );
}
