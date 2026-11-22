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
 * @file        src/app/signup/page.tsx
 * @layer       Presentation (client component)
 * @description
 *  The whitelist-gated account-creation screen. Posts to the existing
 *  `POST /api/auth/signup` controller, which enforces the campus whitelist
 *  server-side before provisioning the Supabase Auth identity + profile. On
 *  success it signs the new student in immediately and hands off to the app.
 *
 * @remarks
 *  The password is sent once to the signup API (which forwards it to Supabase
 *  Auth for hashing) — it is never stored by this app. Server error codes are
 *  mapped to clear, actionable messages (e.g. not-whitelisted, already-registered).
 */

/** Minimum password length — mirrors the API DTO guard. */
const MIN_PASSWORD_LENGTH = 8;

/** Client-side email syntax check, mirroring the API DTO guard. */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Discriminated UI status for the signup form. */
type FormStatus =
  | { readonly kind: "idle" }
  | { readonly kind: "submitting" }
  | { readonly kind: "error"; readonly message: string };

/**
 * The signup page component.
 *
 * @returns The rendered signup screen.
 */
export default function SignupPage(): React.JSX.Element {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<FormStatus>({ kind: "idle" });

  const isSubmitting = status.kind === "submitting";
  const errorMessage = status.kind === "error" ? status.message : null;

  const handleSubmit = useCallback(
    async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
      event.preventDefault();

      const trimmedName = name.trim();
      const normalizedEmail = email.trim().toLowerCase();

      if (trimmedName.length === 0) {
        setStatus({ kind: "error", message: "Please enter your name." });
        return;
      }
      if (!EMAIL_PATTERN.test(normalizedEmail)) {
        setStatus({ kind: "error", message: "Enter a valid email address." });
        return;
      }
      if (password.length < MIN_PASSWORD_LENGTH) {
        setStatus({
          kind: "error",
          message: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
        });
        return;
      }

      setStatus({ kind: "submitting" });

      try {
        // 1. Create the account through the whitelist-gated signup controller.
        const response = await fetch("/api/auth/signup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: trimmedName,
            email: normalizedEmail,
            password,
          }),
        });

        if (!response.ok) {
          const payload = (await response.json().catch(() => null)) as
            | { error?: { code?: string; message?: string } }
            | null;
          const code = payload?.error?.code;
          setStatus({ kind: "error", message: messageForCode(code, payload?.error?.message) });
          return;
        }

        // 2. Account created — sign in immediately so the student lands in the app.
        const supabase = createSupabaseBrowserClient();
        const { error } = await supabase.auth.signInWithPassword({
          email: normalizedEmail,
          password,
        });
        if (error) {
          // Account exists but auto-login failed; send them to sign in manually.
          window.location.assign("/login");
          return;
        }

        window.location.assign("/");
      } catch {
        setStatus({
          kind: "error",
          message: "Network error while creating your account. Please try again.",
        });
      }
    },
    [name, email, password],
  );

  return (
    <AuthShell
      title="Create your account"
      subtitle="Join SpeakCraft to start practicing."
      footer={
        <>
          Already have an account?{" "}
          <Link href="/login" className="font-medium text-brand-primary hover:underline">
            Sign in
          </Link>
          <span className="mt-2 block text-xs text-slate-400">
            You can only register with a whitelisted campus email.
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

        {/* Name */}
        <div className="space-y-1.5">
          <label htmlFor="name" className="block text-sm font-medium text-slate-700">
            Full name
          </label>
          <input
            id="name"
            name="name"
            type="text"
            autoComplete="name"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={isSubmitting}
            placeholder="Priya Sharma"
            className={AUTH_INPUT_CLASS}
          />
        </div>

        {/* Email */}
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

        {/* Password */}
        <div className="space-y-1.5">
          <label htmlFor="password" className="block text-sm font-medium text-slate-700">
            Password
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
            disabled={isSubmitting}
            placeholder="At least 8 characters"
            className={AUTH_INPUT_CLASS}
          />
        </div>

        <button type="submit" disabled={isSubmitting} className={AUTH_BUTTON_CLASS}>
          {isSubmitting ? "Creating account…" : "Create account"}
        </button>
      </form>
    </AuthShell>
  );
}

/**
 * Maps a signup API error code to a clear, actionable message.
 *
 * @param code    - The stable error code from the API envelope.
 * @param fallback - The raw server message, used when the code is unrecognised.
 * @returns A user-facing message.
 */
function messageForCode(code: string | undefined, fallback: string | undefined): string {
  switch (code) {
    case "EMAIL_NOT_WHITELISTED":
      return "That email isn't on the campus list yet. Please check with your instructor.";
    case "EMAIL_ALREADY_REGISTERED":
      return "An account with this email already exists. Try signing in instead.";
    case "VALIDATION_ERROR":
      return fallback ?? "Please check your details and try again.";
    default:
      return fallback ?? "We couldn't create your account. Please try again.";
  }
}
