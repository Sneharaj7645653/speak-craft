"use client";

import { useCallback, useEffect, useState } from "react";

import type {
  ComplianceReportDto,
  StudentComplianceDto,
} from "@/backend/assignment/assignment.dto";
import { formatDuration, formatPercent } from "@/lib/format";

/**
 * @file        src/app/instructor/_components/ComplianceTracker.tsx
 * @layer       Presentation (client component)
 * @description
 *  A compliance monitor listing every student with their assignment progress
 *  and total practice time. Fetches `/api/instructor/metrics` on mount and
 *  offers a manual refresh. Renders a per-student completion bar in the brand
 *  color.
 */

/** UI state machine for the tracker. */
type TrackerState =
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly report: ComplianceReportDto }
  | { readonly kind: "error"; readonly message: string };

/**
 * The compliance tracker card.
 *
 * @returns The rendered tracker.
 */
export function ComplianceTracker(): React.JSX.Element {
  const [state, setState] = useState<TrackerState>({ kind: "loading" });

  const load = useCallback(async (): Promise<void> => {
    setState({ kind: "loading" });
    try {
      const response = await fetch("/api/instructor/metrics", {
        method: "GET",
        cache: "no-store",
      });
      const payload = (await response.json()) as
        | ComplianceReportDto
        | { error: { message: string } };

      if (!response.ok) {
        console.warn("[compliance] load failed:", payload);
        setState({
          kind: "error",
          message: "We couldn't load the compliance report just now. Please refresh in a moment.",
        });
        return;
      }
      setState({ kind: "ready", report: payload as ComplianceReportDto });
    } catch (err) {
      console.warn("[compliance] load error:", err);
      setState({
        kind: "error",
        message: "We couldn't load the compliance report just now. Please refresh in a moment.",
      });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section className="rounded-2xl border border-surface-border bg-white p-6 shadow-card">
      <header className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-slate-900">
            Compliance tracker
          </h2>
          <p className="mt-0.5 text-sm text-slate-500">
            Per-student assignment progress and practice time.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={state.kind === "loading"}
          className="rounded-lg border border-surface-border bg-white px-3 py-1.5 text-sm font-medium text-slate-700 transition-colors hover:border-brand-primary hover:text-brand-primary disabled:opacity-60"
        >
          {state.kind === "loading" ? "Refreshing…" : "Refresh"}
        </button>
      </header>

      {state.kind === "error" ? (
        <div
          role="status"
          className="rounded-lg border border-surface-border bg-surface-raised px-4 py-3 text-sm text-slate-500"
        >
          {state.message}
        </div>

      ) : null}

      {state.kind === "loading" ? (
        <p className="py-8 text-center text-sm text-slate-400">Loading metrics…</p>
      ) : null}

      {state.kind === "ready" && state.report.students.length === 0 ? (
        <p className="py-8 text-center text-sm text-slate-400">
          No students enrolled yet. Upload a roster and have students sign in to
          begin tracking progress.
        </p>
      ) : null}

      {state.kind === "ready" && state.report.students.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-surface-border text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="py-2 pr-4 font-medium">Student</th>
                <th className="py-2 pr-4 font-medium">Completion</th>
                <th className="py-2 pr-4 text-right font-medium">Assigned</th>
                <th className="py-2 pr-4 text-right font-medium">Done</th>
                <th className="py-2 pr-4 text-right font-medium">Sessions</th>
                <th className="py-2 text-right font-medium">Practice</th>
              </tr>
            </thead>
            <tbody>
              {state.report.students.map((student) => (
                <ComplianceRow key={student.studentId} student={student} />
              ))}
            </tbody>
          </table>
          <p className="mt-3 text-xs text-slate-400">
            {state.report.studentCount} student
            {state.report.studentCount === 1 ? "" : "s"} tracked.
          </p>
        </div>
      ) : null}
    </section>
  );
}

/** A single student row with an inline completion bar. */
function ComplianceRow({
  student,
}: {
  readonly student: StudentComplianceDto;
}): React.JSX.Element {
  return (
    <tr className="border-b border-surface-border/70 last:border-0">
      <td className="py-3 pr-4">
        <div className="font-medium text-slate-900">{student.name}</div>
        <div className="text-xs text-slate-400">{student.email}</div>
      </td>
      <td className="py-3 pr-4">
        <div className="flex items-center gap-2">
          <div className="h-2 w-28 overflow-hidden rounded-full bg-surface-raised ring-1 ring-surface-border">
            <div
              className="h-full rounded-full bg-brand-primary"
              style={{ width: formatPercent(student.completionRate) }}
            />
          </div>
          <span className="w-9 text-right text-xs tabular-nums text-slate-500">
            {formatPercent(student.completionRate)}
          </span>
        </div>
      </td>
      <td className="py-3 pr-4 text-right tabular-nums text-slate-700">
        {student.assignmentsAssigned}
      </td>
      <td className="py-3 pr-4 text-right tabular-nums text-slate-700">
        {student.assignmentsCompleted}
      </td>
      <td className="py-3 pr-4 text-right tabular-nums text-slate-700">
        {student.totalSessions}
      </td>
      <td className="py-3 text-right tabular-nums text-slate-700">
        {formatDuration(student.totalSecondsPracticed)}
      </td>
    </tr>
  );
}
