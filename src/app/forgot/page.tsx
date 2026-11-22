"use client";

import Link from "next/link";
import { useCallback, useState } from "react";

import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import {
  AUTH_BUTTON_CLASS,
  AUTH_INPUT_CLASS,
  AuthShell,
} from "@/components/auth/AuthShell";

/**
 * @file        src/app/forgot/page.tsx
 * @layer       Presentation (client component)
 * @description
 *  Requests a password-reset email via Supabase Auth
 *  (`resetPasswordForEmail`), with the recovery link pointing back at `/reset`.
 *
 * @remarks
 *  The confirmation message is deliberately NON-ENUMERATING — it is shown
 *  whether or not the email maps to an account, so the page never reveals which
 *  emails are registered. Supabase only actually sends mail to existing users.
 */

/** Client-side email syntax check, mirroring the API DTO guard. */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Discriminated UI status for the forgot-password form. */
type FormStatus =
  | { readonly kind: "idle" }
  | { readonly kind: "submitting" }
  | { readonly kind: "sent" }
  | { readonly kind: "error"; readonly message: string };

/**
 * The forgot-password page component.
 *
 * @returns The rendered forgot-password screen.
 */
export default function ForgotPasswordPage(): React.JSX.Element {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<FormStatus>({ kind: "idle" });

  const isSubmitting = status.kind === "submitting";

  const handleSubmit = useCallback(
    async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
      event.preventDefault();

      const normalizedEmail = email.trim().toLowerCase();
      if (!EMAIL_PATTERN.test(normalizedEmail)) {
        setStatus({ kind: "error", message: "Enter a valid email address." });
        return;
      }

      setStatus({ kind: "submitting" });

      const supabase = createSupabaseBrowserClient();
      const { error } = await supabase.auth.resetPasswordForEmail(normalizedEmail, {
        redirectTo: `${window.location.origin}/reset`,
      });

      // Non-enumerating: show the same confirmation regardless of the result,
      // unless it's an obvious transport failure worth retrying.
      if (error && error.status && error.status >= 500) {
        setStatus({
          kind: "error",
          message: "Something went wrong sending the email. Please try again.",
        });
        return;
      }
      setStatus({ kind: "sent" });
    },
    [email],
  );

  return (
    <AuthShell
      title="Reset your password"
      subtitle="We'll email you a secure link to set a new one."
      footer={
        <Link href="/login" className="font-medium text-brand-primary hover:underline">
          Back to sign in
        </Link>
      }
    >
      {status.kind === "sent" ? (
        <div
          role="status"
          className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700"
        >
          If an account exists for <span className="font-medium">{email.trim()}</span>,
          a password-reset link is on its way. Please check your inbox (and spam).
        </div>
      ) : (
        <form onSubmit={handleSubmit} noValidate className="space-y-5">
          {status.kind === "error" ? (
            <div
              role="alert"
              className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
            >
              {status.message}
            </div>
          ) : null}

          <div className="space-y-1.5">
            <label htmlFor="email" className="block text-sm font-medium text-slate-700">
              Email address
            </label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={isSubmitting}
              placeholder="you@campus.edu"
              className={AUTH_INPUT_CLASS}
            />
          </div>

          <button type="submit" disabled={isSubmitting} className={AUTH_BUTTON_CLASS}>
            {isSubmitting ? "Sending…" : "Send reset link"}
          </button>
        </form>
      )}
    </AuthShell>
  );
}
