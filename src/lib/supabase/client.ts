import { createBrowserClient } from "@supabase/ssr";

import { publicEnv } from "@/lib/env";
import type { Database } from "@/lib/supabase/database.types";

/**
 * @file        src/lib/supabase/client.ts
 * @layer       Infrastructure / Supabase (browser)
 * @description
 *  Factory for the browser-side Supabase client. This client authenticates with
 *  the public anon key and is subject to Row Level Security. It is the ONLY
 *  Supabase surface a React client component may touch.
 *
 * @remarks
 *  Never import the admin (service-role) client into a client component; that
 *  key bypasses RLS and must remain server-side. The concrete return type is
 *  inferred from `@supabase/ssr`'s factory (and re-exported as
 *  {@link TypedBrowserClient}) to stay in lock-step with the SDK's generic
 *  signature across upgrades.
 */

/**
 * Creates a fresh, RLS-constrained Supabase client for use in the browser,
 * typed against the {@link Database} schema.
 *
 * @returns A Supabase client bound to the public anon key.
 */
export function createSupabaseBrowserClient() {
  return createBrowserClient<Database>(
    publicEnv.supabaseUrl(),
    publicEnv.supabaseAnonKey(),
  );
}

/** The concrete, schema-typed browser client type. */
export type TypedBrowserClient = ReturnType<typeof createSupabaseBrowserClient>;
