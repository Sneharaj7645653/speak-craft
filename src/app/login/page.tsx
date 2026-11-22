"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import {
  AUTH_BUTTON_CLASS,
  AUTH_INPUT_CLASS,
  AuthShell,
} from "@/components/auth/AuthShell";

/**
 * @file        src/app/login/page.tsx
 * @layer       Presentation (client component)
 * @description
 *  The SpeakCraft login screen. Authenticates against Supabase Auth using
 *  email + password via the RLS-constrained browser client, then links out to
 *  the whitelist-gated signup and password-reset flows.
 *
 * @remarks
 *   - Controlled inputs with inline, accessible validation.
 *   - Submits to Supabase `signInWithPassword`.
 *   - Semantic `autoComplete` keeps password managers working; a mount-time
 *     clear (see below) prevents the browser's own form-restoration from leaving
 *     stale, out-of-sync values in the boxes after a refresh.
 *   - No secrets touch this bundle — only the public anon key.
 */

/** Discriminated UI status for the login form state machine. */
type FormStatus =
  | { readonly kind: "idle" }
  | { readonly kind: "submitting" }
  | { readonly kind: "error"; readonly message: string };

/** Minimal client-side email syntax check, mirroring the API DTO guard. */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * The login page component.
 *
 * @returns The rendered login screen.
 */
export default function LoginPage(): React.JSX.Element {
  const [email, setEmail] = useState<string>("");
  const [password, setPassword] = useState<string>("");
  const [status, setStatus] = useState<FormStatus>({ kind: "idle" });

  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  const isSubmitting = status.kind === "submitting";
  const errorMessage = status.kind === "error" ? status.message : null;

  // The browser can restore the last-entered form values on reload by writing
  // straight to the DOM, which leaves the visible boxes out of sync with React
  // state (empty on a fresh mount) — the "stale data after refresh" symptom.
  // Force both the DOM and state empty once on mount so a refresh starts clean.
  // (Semantic autoComplete below still lets a password manager fill on demand;
  // that fill fires input events, so it stays in sync with state.)
  useEffect(() => {
    setEmail("");
    setPassword("");
    if (emailRef.current) emailRef.current.value = "";
    if (passwordRef.current) passwordRef.current.value = "";
  }, []);

  /**
   * Validates inputs, then attempts a password sign-in. Maps Supabase auth
   * failures to a single, non-enumerating error message (so we never reveal
   * whether an email exists).
   */
  const handleSubmit = useCallback(
    async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
      event.preventDefault();

      const normalizedEmail = email.trim().toLowerCase();
      if (!EMAIL_PATTERN.test(normalizedEmail)) {
        setStatus({ kind: "error", message: "Enter a valid email address." });
        return;
      }
      if (password.length === 0) {
        setStatus({ kind: "error", message: "Enter your password." });
        return;
      }

      setStatus({ kind: "submitting" });

      // Construct the browser client on demand (client-side only) so the
      // component never touches Supabase config during server prerender.
      const supabase = createSupabaseBrowserClient();
      const { error } = await supabase.auth.signInWithPassword({
        email: normalizedEmail,
        password,
      });

      if (error) {
        setStatus({
          kind: "error",
          message: "Incorrect email or password. Please try again.",
        });
        return;
      }

      // Authenticated — hand off to the app shell.
      window.location.assign("/");
    },
    [email, password],
  );

  return (
    <AuthShell
      title="Welcome back"
      subtitle="Sign in to continue practicing with SpeakCraft."
      footer={
        <>
          New here?{" "}
          <Link
            href="/signup"
            className="font-medium text-brand-primary hover:underline"
          >
            Create your account
          </Link>
          <span className="mt-2 block text-xs text-slate-400">
            Access is limited to whitelisted campus emails.
          </span>
        </>
      }
    >
      <form onSubmit={handleSubmit} noValidate className="space-y-5">
        {errorMessage ? (
          <div
            role="alert"
            className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
          >
            {errorMessage}
          </div>
        ) : null}

        {/* Email */}
        <div className="space-y-1.5">
          <label htmlFor="email" className="block text-sm font-medium text-slate-700">
            Email address
          </label>
          <input
            ref={emailRef}
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

        {/* Password */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label
              htmlFor="password"
              className="block text-sm font-medium text-slate-700"
            >
              Password
            </label>
            <Link
              href="/forgot"
              className="text-xs font-medium text-brand-primary hover:underline"
            >
              Forgot password?
            </Link>
          </div>
          <input
            ref={passwordRef}
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={isSubmitting}
            placeholder="••••••••"
            className={AUTH_INPUT_CLASS}
          />
        </div>

        <button type="submit" disabled={isSubmitting} className={AUTH_BUTTON_CLASS}>
          {isSubmitting ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </AuthShell>
  );
}
