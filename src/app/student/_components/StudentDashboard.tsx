"use client";

import { useRouter } from "next/navigation";
import { useCallback } from "react";

import { AssignmentCards } from "@/app/student/_components/AssignmentCards";
import { StreakBlock } from "@/app/student/_components/StreakBlock";

/**
 * @file        src/app/student/_components/StudentDashboard.tsx
 * @layer       Presentation (client component — dashboard orchestrator)
 * @description
 *  The interactive shell of the student dashboard. It wires:
 *   - the gamified {@link StreakBlock},
 *   - a call-to-action to start a free voice-practice session, and
 *   - the {@link AssignmentCards}, whose "Practice" action opens the voice room
 *     for that specific assignment.
 *
 *  All actual practice happens in the Voice Coach room (`/student/practice`),
 *  which captures speech, counts the time toward the streak, and — for a formal
 *  assignment — records the attempt and streams AI coaching. This component just
 *  routes the student there.
 */
export function StudentDashboard(): React.JSX.Element {
  const router = useRouter();

  /** Opens the voice room, optionally scoped to a formal assignment. */
  const goToPractice = useCallback(
    (assignmentId?: string) => {
      router.push(
        assignmentId
          ? `/student/practice?assignmentId=${encodeURIComponent(assignmentId)}`
          : "/student/practice",
      );
    },
    [router],
  );

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      {/* Left rail: gamification + a way into free practice. */}
      <div className="space-y-6 lg:col-span-1">
        <StreakBlock />

        <section className="rounded-2xl border border-surface-border bg-white p-6 shadow-card">
          <h2 className="text-base font-semibold text-slate-900">
            Practice out loud
          </h2>
          <p className="mt-0.5 text-sm text-slate-500">
            Speak freely, and get instant AI coaching. Your time counts toward
            today&apos;s streak.
          </p>
          <button
            type="button"
            onClick={() => goToPractice()}
            className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg bg-brand-primary px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-primary-hover"
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z" />
              <path d="M19 10v2a7 7 0 01-14 0v-2M12 19v4" />
            </svg>
            Start free voice practice
          </button>
        </section>
      </div>

      {/* Main column: assignments — each opens the voice room for that task. */}
      <div className="lg:col-span-2">
        <AssignmentCards onPractice={goToPractice} />
      </div>
    </div>
  );
}
