import type { Metadata } from "next";

import { StudentDashboard } from "@/app/student/_components/StudentDashboard";

/**
 * @file        src/app/student/page.tsx
 * @layer       Presentation (App Router page — server component shell)
 * @description
 *  The Student Home dashboard. A responsive, light-themed shell that hosts the
 *  interactive {@link StudentDashboard}: the gamified streak tracker, the
 *  instructor-issued assignment cards, and the live practice console driven by
 *  the 30-second heartbeat engine.
 *
 * @remarks
 *  Rendered as a server component for a fast static shell; all interactivity and
 *  data fetching happen in the client widgets against the `/api/student/*`
 *  routes, which enforce authorization and the governance rules server-side.
 */

/** Page metadata for the student dashboard. */
export const metadata: Metadata = {
  title: "Home — SpeakCraft",
  description:
    "Track your speaking streak, view assignments, and practice with automatic session syncing.",
};

/**
 * The student dashboard page.
 *
 * @returns The rendered dashboard shell.
 */
export default function StudentHomePage(): React.JSX.Element {
  return (
    <div className="min-h-screen bg-surface-base">
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
              Your practice home
            </h1>
            <p className="text-xs text-slate-500">
              Keep your streak alive — a little every day.
            </p>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-8">
        <StudentDashboard />
      </main>
    </div>
  );
}
