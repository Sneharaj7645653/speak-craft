import { createServerClient, type SetAllCookies } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { publicEnv } from "@/lib/env";

/**
 * @file        src/middleware.ts
 * @layer       Edge middleware (session refresh + route gating)
 * @description
 *  Runs on every page navigation to:
 *   1. Refresh the Supabase auth session and write the rotated cookies back onto
 *      the response, so server components (which can only READ cookies) don't
 *      silently sign users out when the access token rotates.
 *   2. Redirect UNAUTHENTICATED visitors away from protected areas
 *      (`/student*`, `/instructor*`) to `/login`.
 *
 * @remarks
 *  Deliberately ONE-DIRECTIONAL: middleware never redirects *away from* `/login`
 *  or `/signup`. The session-aware root route (`/`) is the sole component that
 *  routes authenticated users onward (by role). Having only one redirector that
 *  can target `/login` makes an infinite `/ ↔ /login` loop impossible — the bug
 *  a previous two-way rule caused.
 *
 *  Redirect responses copy over any cookies the session refresh set, so a
 *  refreshed/cleared session is never lost across the redirect. API routes and
 *  static assets are excluded via the matcher; API routes enforce their own auth.
 */

/** Path prefixes that require an authenticated session. */
const PROTECTED_PREFIXES = ["/student", "/instructor"] as const;

/**
 * The middleware entrypoint.
 *
 * @param request - The incoming request.
 * @returns The (possibly redirected) response, carrying refreshed session cookies.
 */
export async function middleware(request: NextRequest): Promise<NextResponse> {
  // Start from a pass-through response we can attach refreshed cookies to.
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    publicEnv.supabaseUrl(),
    publicEnv.supabaseAnonKey(),
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: Parameters<SetAllCookies>[0]) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  // Validates + refreshes the session; rotated tokens are written via setAll above.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  const isProtected = PROTECTED_PREFIXES.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`),
  );

  // Unauthenticated visitor to a protected area → send to sign in.
  if (!user && isProtected) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    const redirectResponse = NextResponse.redirect(url);
    // Preserve any auth cookies the refresh set/cleared, so the session stays
    // consistent across the redirect (otherwise the refresh would be lost).
    for (const cookie of response.cookies.getAll()) {
      redirectResponse.cookies.set(cookie);
    }
    return redirectResponse;
  }

  return response;
}

/**
 * Run on everything except Next internals, static assets, and API routes (which
 * enforce their own authorization).
 */
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api).*)"],
};
