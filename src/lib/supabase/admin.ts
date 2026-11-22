import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { publicEnv, serverEnv } from "@/lib/env";
import type { Database } from "@/lib/supabase/database.types";

/**
 * @file        src/lib/supabase/admin.ts
 * @layer       Infrastructure / Supabase (server, privileged)
 * @description
 *  Factory for the privileged Supabase client used exclusively by the backend
 *  (repository & service layers). It authenticates with the SERVICE ROLE key
 *  and therefore BYPASSES Row Level Security — it can read the `allowed_emails`
 *  whitelist and provision `users` rows that clients cannot touch.
 *
 * @remarks
 *  The `import "server-only"` directive causes a build-time error if this module
 *  is ever pulled into a client bundle, hardening the secret against leakage.
 *  A single client instance is memoised per server process.
 */

/** Process-level singleton so we don't re-instantiate on every request. */
let cached: SupabaseClient<Database> | null = null;

/**
 * Returns the memoised, service-role Supabase admin client.
 *
 * @returns A typed {@link SupabaseClient} that bypasses RLS.
 * @throws {Error} When required environment variables are missing.
 */
export function getSupabaseAdminClient(): SupabaseClient<Database> {
  if (cached) return cached;

  cached = createClient<Database>(
    publicEnv.supabaseUrl(),
    serverEnv.supabaseServiceRoleKey(),
    {
      auth: {
        // This is a machine identity: never persist or refresh a user session.
        autoRefreshToken: false,
        persistSession: false,
      },
    },
  );

  return cached;
}
