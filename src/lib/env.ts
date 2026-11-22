/**
 * @file        src/lib/env.ts
 * @layer       Infrastructure / Configuration
 * @description
 *  Centralised, fail-fast accessor for environment variables. Every consumer
 *  reads configuration through this module so that a missing or malformed
 *  variable surfaces as a single, descriptive error at the point of use rather
 *  than an opaque `undefined` deep inside the Supabase SDK.
 *
 * @remarks
 *  CRITICAL — client bundle inlining: Next.js only inlines `NEXT_PUBLIC_*`
 *  variables into the browser bundle when they are referenced as STATIC member
 *  expressions (e.g. `process.env.NEXT_PUBLIC_SUPABASE_URL`). A DYNAMIC lookup
 *  such as `process.env[name]` is invisible to the compiler and is therefore
 *  NOT inlined — it evaluates to `undefined` in the browser. For that reason the
 *  public accessors below reference each variable by its literal name; the
 *  validation helpers only receive the already-resolved value.
 *
 *  The service-role and AI keys are NOT prefixed with `NEXT_PUBLIC_` and are
 *  only present server-side; referencing them from client code yields
 *  `undefined` (an intentional guardrail).
 */

/**
 * Validates a required, already-resolved environment value.
 *
 * @param name - The variable's name (for the error message only).
 * @param raw  - The resolved value (from a static `process.env.X` reference).
 * @returns The trimmed, non-empty value.
 * @throws {Error} When the value is undefined or blank.
 */
function requireValue(name: string, raw: string | undefined): string {
  const value = raw?.trim();
  if (!value) {
    throw new Error(
      `[env] Missing required environment variable "${name}". ` +
        `Copy .env.local.example to .env.local and populate it, then restart the dev server.`,
    );
  }
  return value;
}

/**
 * Normalises an optional, already-resolved environment value.
 *
 * @param raw - The resolved value (from a static `process.env.X` reference).
 * @returns The trimmed value, or `undefined` if unset/blank.
 */
function optionalValue(raw: string | undefined): string | undefined {
  const value = raw?.trim();
  return value && value.length > 0 ? value : undefined;
}

/**
 * Publicly-safe Supabase configuration (inlined into the browser bundle).
 * The anon key is not a secret — Row Level Security is the security boundary.
 */
export const publicEnv = {
  supabaseUrl: (): string =>
    requireValue("NEXT_PUBLIC_SUPABASE_URL", process.env.NEXT_PUBLIC_SUPABASE_URL),
  supabaseAnonKey: (): string =>
    requireValue(
      "NEXT_PUBLIC_SUPABASE_ANON_KEY",
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    ),
} as const;

/**
 * Server-only Supabase configuration. `SUPABASE_SERVICE_ROLE_KEY` is absent from
 * the client bundle, so reading this from browser code will throw.
 */
export const serverEnv = {
  supabaseServiceRoleKey: (): string =>
    requireValue("SUPABASE_SERVICE_ROLE_KEY", process.env.SUPABASE_SERVICE_ROLE_KEY),
} as const;

/**
 * AI provider credentials for the multi-LLM coach. These are intentionally
 * OPTIONAL and non-throwing: the failover architecture tolerates a missing key
 * (e.g. no Groq key → route straight to Gemini), so absence must not crash the
 * service. Both keys are server-only.
 */
export const aiEnv = {
  groqApiKey: (): string | undefined => optionalValue(process.env.GROQ_API_KEY),
  geminiApiKey: (): string | undefined => optionalValue(process.env.GEMINI_API_KEY),
} as const;
