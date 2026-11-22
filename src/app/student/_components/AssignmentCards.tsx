"use client";

import { useCallback, useEffect, useState } from "react";

import type {
  StudentAssignmentsDto,
  StudentAssignmentViewDto,
} from "@/backend/assignment/assignment.dto";
import type { AssignmentFormat } from "@/backend/assignment/assignment.entity";

/**
 * @file        src/app/student/_components/AssignmentCards.tsx
 * @layer       Presentation (client component)
 * @description
 *  Structured cards summarising the instructor-issued assignments for the
 *  student, each showing the speaking format, completion status, and remaining
 *  attempts (the retake guardrail). A "Practice" action opens the Voice Coach
 *  room scoped to that assignment.
 *
 * @param onPractice - Invoked with the assignment id to open the voice room.
 * @param refreshKey - Bump to refetch (e.g. on return from a practice session).
 */
export function AssignmentCards({
  onPractice,
  refreshKey = 0,
}: {
  readonly onPractice: (assignmentId: string) => void;
  readonly refreshKey?: number;
}): React.JSX.Element {
  const [data, setData] = useState<StudentAssignmentsDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    try {
      const response = await fetch("/api/student/assignments", {
        cache: "no-store",
      });
      const payload = (await response.json()) as
        | StudentAssignmentsDto
        | { error: { message: string } };
      if (!response.ok) {
        // Keep the technical detail in the console; show the student calm copy.
        console.warn("[assignments] load failed:", payload);
        setError("We couldn't load your assignments just now. Please refresh in a moment.");
        return;
      }
      setData(payload as StudentAssignmentsDto);
      setError(null);
    } catch (err) {
      console.warn("[assignments] load error:", err);
      setError("We couldn't load your assignments just now. Please refresh in a moment.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  return (
    <section className="rounded-2xl border border-surface-border bg-white p-6 shadow-card">
      <header className="mb-4">
        <h2 className="text-base font-semibold text-slate-900">
          Your assignments
        </h2>
        <p className="mt-0.5 text-sm text-slate-500">
          Speaking tasks issued by your instructor.
        </p>
      </header>

      {error ? (
        <div
          role="status"
          className="rounded-lg border border-surface-border bg-surface-raised px-4 py-3 text-sm text-slate-500"
        >
          {error}
        </div>
      ) : null}

      {data && data.assignments.length === 0 ? (
        <p className="py-8 text-center text-sm text-slate-400">
          No assignments yet. Your instructor will post speaking tasks here.
        </p>
      ) : null}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {data?.assignments.map((assignment) => (
          <AssignmentCard
            key={assignment.id}
            assignment={assignment}
            onPractice={onPractice}
          />
        ))}
      </div>
    </section>
  );
}

/** Tailwind classes for each format's accent chip. */
const FORMAT_CHIP: Record<AssignmentFormat, string> = {
  extempore: "bg-brand-primary-subtle text-brand-primary",
  debate: "bg-amber-50 text-amber-700",
  declamation: "bg-emerald-50 text-emerald-700",
};

/** Human labels for each format. */
const FORMAT_LABEL: Record<AssignmentFormat, string> = {
  extempore: "Extempore",
  debate: "Debate",
  declamation: "Declamation",
};

/** A single assignment card. */
function AssignmentCard({
  assignment,
  onPractice,
}: {
  readonly assignment: StudentAssignmentViewDto;
  readonly onPractice: (assignmentId: string) => void;
}): React.JSX.Element {
  const completed = assignment.status === "completed";

  return (
    <article className="flex flex-col rounded-xl border border-surface-border bg-surface-raised p-4 transition-colors">
      <div className="mb-2 flex items-center gap-2">
        <span
          className={[
            "rounded-full px-2.5 py-0.5 text-xs font-medium",
            FORMAT_CHIP[assignment.formatType],
          ].join(" ")}
        >
          {FORMAT_LABEL[assignment.formatType]}
        </span>
        {completed ? (
          <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700">
            Completed
          </span>
        ) : null}
      </div>

      <h3 className="text-sm font-semibold text-slate-900">{assignment.title}</h3>
      {assignment.description ? (
        <p className="mt-1 line-clamp-3 text-sm text-slate-500">
          {assignment.description}
        </p>
      ) : null}

      <div className="mt-3 flex items-center justify-between gap-2 pt-1">
        <span className="text-xs text-slate-500">
          {assignment.attemptsRemaining} of{" "}
          {assignment.attemptsUsed + assignment.attemptsRemaining} attempts left
        </span>
        <button
          type="button"
          onClick={() => onPractice(assignment.id)}
          disabled={!assignment.canAttempt}
          className="rounded-lg bg-brand-primary px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-brand-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
        >
          {assignment.canAttempt ? "Practice" : "No attempts left"}
        </button>
      </div>
    </article>
  );
}
