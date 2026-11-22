import Link from "next/link";

/**
 * @file        src/components/auth/AuthShell.tsx
 * @layer       Presentation (shared presentational component)
 * @description
 *  The common chrome for every authentication screen (login, signup, forgot,
 *  reset): a centered, light-themed brand card on a crisp white canvas using the
 *  `#004CE5` brand color. Keeps all auth screens visually identical while each
 *  page supplies only its own form via `children`.
 */

/**
 * Renders the shared auth-screen frame.
 *
 * @param props.title    - The heading shown above the card.
 * @param props.subtitle - The supporting line under the heading.
 * @param props.children - The page's form / card body.
 * @param props.footer   - Optional footer node (e.g. cross-links).
 * @returns The rendered auth shell.
 */
export function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: {
  readonly title: string;
  readonly subtitle: string;
  readonly children: React.ReactNode;
  readonly footer?: React.ReactNode;
}): React.JSX.Element {
  return (
    <main className="flex min-h-screen items-center justify-center bg-surface-base px-4 py-12">
      <div className="w-full max-w-md">
        {/* Brand mark */}
        <div className="mb-8 flex flex-col items-center text-center">
          <Link
            href="/login"
            aria-label="SpeakCraft home"
            className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-xl bg-brand-primary text-lg font-bold text-white shadow-card"
          >
            SC
          </Link>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            {title}
          </h1>
          <p className="mt-1 text-sm text-slate-500">{subtitle}</p>
        </div>

        {/* Card */}
        <div className="rounded-2xl border border-surface-border bg-surface-raised p-6 shadow-card sm:p-8">
          {children}
        </div>

        {footer ? (
          <div className="mt-6 text-center text-sm text-slate-500">{footer}</div>
        ) : null}
      </div>
    </main>
  );
}

/** Shared input classes so every auth field looks identical. */
export const AUTH_INPUT_CLASS =
  "block w-full rounded-lg border border-surface-border bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 transition-colors focus:border-brand-primary disabled:opacity-60";

/** Shared primary-button classes for auth submit actions. */
export const AUTH_BUTTON_CLASS =
  "flex w-full items-center justify-center rounded-lg bg-brand-primary px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-primary-hover disabled:cursor-not-allowed disabled:opacity-70";
