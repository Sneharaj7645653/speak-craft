import type { Metadata } from "next";

import { AssignmentComposer } from "@/app/instructor/_components/AssignmentComposer";
import { ComplianceTracker } from "@/app/instructor/_components/ComplianceTracker";
import { RosterUploader } from "@/app/instructor/_components/RosterUploader";

/**
 * @file        src/app/instructor/page.tsx
 * @layer       Presentation (App Router page — server component shell)
 * @description
 *  The instructor dashboard. A clean, light-themed shell that composes the three
 *  Phase 2 workflows as client widgets:
 *   - {@link RosterUploader}     — drag-and-drop roster ingestion.
 *   - {@link AssignmentComposer} — dispatch a speaking assignment to the cohort.
 *   - {@link ComplianceTracker}  — monitor per-student progress metrics.
 *
 * @remarks
 *  Rendered as a server component for a fast static shell; interactivity lives
 *  in the client widgets. Data access and authorization remain server-side in
 *  the API routes those widgets call.
 */

/** Page metadata for the instructor dashboard. */
export const metadata: Metadata = {
  title: "Instructor Dashboard — SpeakCraft",
  description: "Manage your roster, dispatch assignments, and track cohort progress.",
};

/**
 * The instructor dashboard page.
 *
 * @returns The rendered dashboard shell.
 */
export default function InstructorDashboardPage(): React.JSX.Element {
  return (
    <div className="min-h-screen bg-surface-base">
      {/* Top bar */}
      <header className="border-b border-surface-border bg-white">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-6 py-4">
          <span
            aria-hidden="true"
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-brand-primary text-sm font-bold text-white"
          >
            SC
          </span>
          <div>
            <h1 className="text-lg font-semibold tracking-tight text-slate-900">
              Instructor Dashboard
            </h1>
            <p className="text-xs text-slate-500">
              Roster management &amp; assignment distribution
            </p>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-8">
        {/* Top row: roster ingestion + assignment dispatch, side by side. */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <RosterUploader />
          <AssignmentComposer />
        </div>

        {/* Full-width compliance tracker. */}
        <div className="mt-6">
          <ComplianceTracker />
        </div>
      </main>
    </div>
  );
}
