"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import {
  AUTH_BUTTON_CLASS,
  AUTH_INPUT_CLASS,
  AuthShell,
} from "@/components/auth/AuthShell";

/**
 * @file        src/app/reset/page.tsx
 * @layer       Presentation (client component)
 * @description
 *  The landing page for the password-reset email link. Supabase's recovery link
 *  carries a one-time credential that establishes a short-lived recovery
 *  session; this page detects that session and lets the student set a new
 *  password via `supabase.auth.updateUser`.
 *
 * @remarks
 *  Session detection is resilient to both delivery styles:
 *   - implicit/hash links — the SDK auto-detects the session in the URL and
 *     fires a `PASSWORD_RECOVERY` auth event, which we observe;
 *   - PKCE `?code=` links — we exchange the code for a session explicitly.
 *  If no valid recovery session materialises, the form is withheld and the user
 *  is guided to request a fresh link. Requires the reset redirect URL to be
 *  allow-listed in the Supabase Auth settings.
 */

/** Minimum password length — mirrors the API DTO guard. */
const MIN_PASSWORD_LENGTH = 8;

/** Recovery-session detection phase. */
type Phase = "verifying" | "ready" | "invalid" | "saving" | "done";

/**
 * The reset-password page component.
 *
 * @returns The rendered reset screen.
 */
export default function ResetPasswordPage(): React.JSX.Element {
  const [phase, setPhase] = useState<Phase>("verifying");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Establish the recovery session from the link, however it was delivered.
  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    let active = true;

    // Hash/implicit links: the SDK emits PASSWORD_RECOVERY once it parses the URL.
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (!active) return;
      if (event === "PASSWORD_RECOVERY" || session) setPhase("ready");
    });

    void (async () => {
      // Already have a session (e.g. SDK auto-detected the hash token)?
      const { data: existing } = await supabase.auth.getSession();
      if (!active) return;
      if (existing.session) {
        setPhase("ready");
        return;
      }

      // PKCE links carry a ?code= to exchange for a session.
      const code = new URLSearchParams(window.location.search).get("code");
      if (code) {
        const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
        if (!active) return;
        setPhase(exchangeError ? "invalid" : "ready");
        return;
      }

      // Give the async auth-state listener a brief moment before giving up.
      window.setTimeout(() => {
        if (active) setPhase((p) => (p === "verifying" ? "invalid" : p));
      }, 1500);
    })();

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const handleSubmit = useCallback(
    async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
      event.preventDefault();
      setError(null);

      if (password.length < MIN_PASSWORD_LENGTH) {
        setError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
        return;
      }
      if (password !== confirm) {
        setError("The two passwords do not match.");
        return;
      }

      setPhase("saving");
      const supabase = createSupabaseBrowserClient();
      const { error: updateError } = await supabase.auth.updateUser({ password });

      if (updateError) {
        setError("We couldn't update your password. Your reset link may have expired.");
        setPhase("ready");
        return;
      }
      setPhase("done");
    },
    [password, confirm],
  );

  return (
    <AuthShell
      title="Set a new password"
      subtitle="Choose a strong password you'll remember."
      footer={
        <Link href="/login" className="font-medium text-brand-primary hover:underline">
          Back to sign in
        </Link>
      }
    >
      {phase === "verifying" ? (
        <p className="py-6 text-center text-sm text-slate-400">
          Verifying your reset link…
        </p>
      ) : null}

      {phase === "invalid" ? (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          This reset link is invalid or has expired. Please{" "}
          <Link href="/forgot" className="font-medium underline">
            request a new one
          </Link>
          .
        </div>
      ) : null}

      {phase === "done" ? (
        <div
          role="status"
          className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700"
        >
          Your password has been updated. You can now{" "}
          <Link href="/login" className="font-medium underline">
            sign in
          </Link>
          .
        </div>
      ) : null}

      {phase === "ready" || phase === "saving" ? (
        <form onSubmit={handleSubmit} noValidate className="space-y-5">
          {error ? (
            <div
              role="alert"
              className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
            >
              {error}
            </div>
          ) : null}

          <div className="space-y-1.5">
            <label htmlFor="password" className="block text-sm font-medium text-slate-700">
              New password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="new-password"
              required
              minLength={MIN_PASSWORD_LENGTH}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={phase === "saving"}
              placeholder="At least 8 characters"
              className={AUTH_INPUT_CLASS}
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="confirm" className="block text-sm font-medium text-slate-700">
              Confirm new password
            </label>
            <input
              id="confirm"
              name="confirm"
              type="password"
              autoComplete="new-password"
              required
              minLength={MIN_PASSWORD_LENGTH}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              disabled={phase === "saving"}
              placeholder="Re-enter your new password"
              className={AUTH_INPUT_CLASS}
            />
          </div>

          <button
            type="submit"
            disabled={phase === "saving"}
            className={AUTH_BUTTON_CLASS}
          >
            {phase === "saving" ? "Updating…" : "Update password"}
          </button>
        </form>
      ) : null}
    </AuthShell>
  );
}
