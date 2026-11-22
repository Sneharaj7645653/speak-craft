"use client";

import { useCallback, useEffect, useState } from "react";

import type { StreakSummaryDto } from "@/backend/session/streak.dto";
import { formatDuration, formatPercent } from "@/lib/format";

/**
 * @file        src/app/student/_components/StreakBlock.tsx
 * @layer       Presentation (client component)
 * @description
 *  The gamified tracking block. Fetches `/api/student/streak` and renders the
 *  active consecutive-day streak, today's progress toward the cumulative goal,
 *  and a compact recent-day history strip.
 *
 * @param refreshKey - Bumping this (e.g. when a practice session ends) triggers
 *                     a refetch so the streak reflects freshly-credited time.
 */
export function StreakBlock({
  refreshKey = 0,
}: {
  readonly refreshKey?: number;
}): React.JSX.Element {
  const [summary, setSummary] = useState<StreakSummaryDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    try {
      const response = await fetch("/api/student/streak", { cache: "no-store" });
      const payload = (await response.json()) as
        | StreakSummaryDto
        | { error: { message: string } };
      if (!response.ok) {
        console.warn("[streak] load failed:", payload);
        setError("We couldn't load your streak just now. Please refresh in a moment.");
        return;
      }
      setSummary(payload as StreakSummaryDto);
      setError(null);
    } catch (err) {
      console.warn("[streak] load error:", err);
      setError("We couldn't load your streak just now. Please refresh in a moment.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const progress = summary
    ? Math.min(1, summary.todaySeconds / summary.dailyGoalSeconds)
    : 0;

  return (
    <section className="overflow-hidden rounded-2xl border border-surface-border bg-white shadow-card">
      {/* Brand banner */}
      <div className="bg-brand-primary px-6 py-5 text-white">
        <p className="text-sm font-medium opacity-90">Current streak</p>
        <div className="mt-1 flex items-baseline gap-2">
          <span className="text-4xl font-bold tabular-nums">
            {summary?.currentStreak ?? "—"}
          </span>
          <span className="text-lg font-medium opacity-90">
            day{summary?.currentStreak === 1 ? "" : "s"}
          </span>
          {summary?.todayIsAtRisk ? (
            <span className="ml-auto rounded-full bg-white/20 px-2.5 py-1 text-xs font-medium">
              At risk today
            </span>
          ) : summary?.goalMetToday ? (
            <span className="ml-auto rounded-full bg-white/20 px-2.5 py-1 text-xs font-medium">
              Secured today ✓
            </span>
          ) : null}
        </div>
      </div>

      <div className="p-6">
        {error ? (
          <div
            role="status"
            className="mb-4 rounded-lg border border-surface-border bg-surface-raised px-4 py-3 text-sm text-slate-500"
          >
            {error}
          </div>
        ) : null}

        {/* Today's goal progress */}
        <div className="mb-2 flex items-center justify-between text-sm">
          <span className="font-medium text-slate-700">Today&apos;s goal</span>
          <span className="tabular-nums text-slate-500">
            {summary ? formatDuration(summary.todaySeconds) : "—"} /{" "}
            {summary ? formatDuration(summary.dailyGoalSeconds) : "—"}
          </span>
        </div>
        <div className="h-2.5 w-full overflow-hidden rounded-full bg-surface-raised ring-1 ring-surface-border">
          <div
            className="h-full rounded-full bg-brand-primary transition-all"
            style={{ width: formatPercent(progress) }}
          />
        </div>

        {/* Stats row */}
        <dl className="mt-5 grid grid-cols-2 gap-3">
          <div className="rounded-lg bg-surface-raised p-3 ring-1 ring-surface-border">
            <dt className="text-xs text-slate-500">Longest streak</dt>
            <dd className="mt-0.5 text-lg font-semibold text-slate-900">
              {summary?.longestStreak ?? "—"} days
            </dd>
          </div>
          <div className="rounded-lg bg-surface-raised p-3 ring-1 ring-surface-border">
            <dt className="text-xs text-slate-500">Daily ceiling</dt>
            <dd className="mt-0.5 text-lg font-semibold text-slate-900">
              {summary ? formatDuration(summary.dailyCapSeconds) : "—"}
            </dd>
          </div>
        </dl>

        {/* Recent history strip (last 14 days) */}
        {summary && summary.history.length > 0 ? (
          <div className="mt-5">
            <p className="mb-2 text-xs font-medium text-slate-500">Recent days</p>
            <div className="flex gap-1.5">
              {[...summary.history]
                .slice(0, 14)
                .reverse()
                .map((day) => (
                  <div
                    key={day.date}
                    title={`${day.date}: ${formatDuration(day.seconds)}`}
                    className={[
                      "h-8 flex-1 rounded",
                      day.goalMet
                        ? "bg-brand-primary"
                        : day.seconds > 0
                          ? "bg-brand-primary/30"
                          : "bg-surface-raised ring-1 ring-surface-border",
                    ].join(" ")}
                  />
                ))}
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}
