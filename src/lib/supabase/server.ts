import "server-only";

import { cookies } from "next/headers";
import { createServerClient, type SetAllCookies } from "@supabase/ssr";

import { publicEnv } from "@/lib/env";
import type { Database } from "@/lib/supabase/database.types";

/**
 * @file        src/lib/supabase/server.ts
 * @layer       Infrastructure / Supabase (server, request-scoped session)
 * @description
 *  Factory for a request-scoped Supabase client bound to the CURRENT USER'S
 *  session, read from the request cookies. Unlike the service-role admin client,
 *  this client is subject to Row Level Security — it can only see what the
 *  signed-in user is permitted to see. It is used by the authorization guard to
 *  identify the caller and read their own profile row.
 *
 * @remarks
 *  Must be called within a request scope (Route Handler / Server Component /
 *  Server Action) because it reads `next/headers` cookies. The `setAll` handler
 *  is wrapped in try/catch: token-refresh writes are a no-op in read-only
 *  contexts (e.g. Server Components), which is safe for our read-only guard.
 */

/**
 * Creates a request-scoped, RLS-constrained Supabase client using the caller's
 * session cookies.
 *
 * @returns A Supabase client authenticated as the current user (or anonymous).
 */
export function createSupabaseServerClient() {
  const cookieStore = cookies();

  return createServerClient<Database>(
    publicEnv.supabaseUrl(),
    publicEnv.supabaseAnonKey(),
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet: Parameters<SetAllCookies>[0]) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Called from a context where cookie mutation is not permitted
            // (e.g. a Server Component). Safe to ignore for read-only guards.
          }
        },
      },
    },
  );
}
