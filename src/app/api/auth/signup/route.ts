import { NextResponse } from "next/server";

import { AuthService } from "@/backend/user/auth.service";
import { validateSignupRequest } from "@/backend/user/user.dto";
import type { SignupResponseDto } from "@/backend/user/user.dto";
import { UserDomainError } from "@/backend/user/user.errors";

/**
 * @file        src/app/api/auth/signup/route.ts
 * @layer       Controller Layer (HTTP boundary — Next.js Route Handler)
 * @route        POST /api/auth/signup
 * @description
 *  The direct HTTP endpoint for account creation. Its responsibilities are
 *  strictly transport-level: parse the request, delegate validation to the DTO
 *  layer, invoke the service, catch errors, and map every outcome to a semantic
 *  HTTP status code. It contains NO business logic — the whitelist rule lives in
 *  {@link AuthService}.
 *
 * @remarks
 *  `runtime = 'nodejs'` is required because the service depends on the
 *  service-role Supabase client (a server-only secret). `dynamic = 'force-dynamic'`
 *  disables any caching of this mutating endpoint.
 */

/** This handler must run on the Node.js runtime (uses server-only secrets). */
export const runtime = "nodejs";

/** Never cache a mutating auth endpoint. */
export const dynamic = "force-dynamic";

/** Shape of the JSON error envelope returned on failure. */
interface ErrorEnvelope {
  error: { code: string; message: string; details?: readonly string[] };
}

/**
 * Builds a typed JSON error response.
 *
 * @param status  - HTTP status code.
 * @param code    - Stable machine-readable error code.
 * @param message - Human-readable, client-safe message.
 * @param details - Optional field-level detail strings.
 */
function errorResponse(
  status: number,
  code: string,
  message: string,
  details?: readonly string[],
): NextResponse<ErrorEnvelope> {
  return NextResponse.json<ErrorEnvelope>(
    { error: { code, message, ...(details ? { details } : {}) } },
    { status },
  );
}

/**
 * Handles account signup.
 *
 * Input  (JSON body): `{ email: string; password: string; name: string }`
 * Output (201)       : `{ user: UserResponseDto }`
 *
 * Status contract:
 *  - `201 Created`      — account created; body is {@link SignupResponseDto}.
 *  - `400 Bad Request`  — malformed JSON or DTO validation failure.
 *  - `403 Forbidden`    — email not on the campus whitelist.
 *  - `409 Conflict`     — email already registered.
 *  - `502 Bad Gateway`  — upstream auth provider error.
 *  - `500 Internal`     — profile persistence or unexpected error.
 *
 * @param request - The incoming HTTP request.
 * @returns A JSON response following the status contract above.
 */
export async function POST(request: Request): Promise<NextResponse> {
  // 1. Parse the body defensively — malformed JSON is a 400, never a 500.
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse(
      400,
      "VALIDATION_ERROR",
      "Request body must be valid JSON.",
    );
  }

  // 2. Validate & normalise at the DTO boundary.
  const validation = validateSignupRequest(body);
  if (!validation.ok) {
    return errorResponse(
      400,
      "VALIDATION_ERROR",
      "Request validation failed.",
      validation.errors,
    );
  }

  // 3. Delegate to the service layer and map outcomes to status codes.
  try {
    const service = new AuthService();
    const user = await service.signup(validation.value);
    const payload: SignupResponseDto = { user };
    return NextResponse.json<SignupResponseDto>(payload, { status: 201 });
  } catch (error) {
    if (error instanceof UserDomainError) {
      return errorResponse(error.status, error.code, error.message, error.details);
    }
    // Unknown failure — do not leak internals to the client.
    console.error("[POST /api/auth/signup] Unhandled error:", error);
    return errorResponse(
      500,
      "INTERNAL_ERROR",
      "An unexpected error occurred. Please try again.",
    );
  }
}
