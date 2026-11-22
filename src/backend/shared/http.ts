import { NextResponse } from "next/server";

import { AppError } from "@/backend/shared/app-error";

/**
 * @file        src/backend/shared/http.ts
 * @layer       Controller support (transport helpers)
 * @description
 *  Shared helpers that keep every route handler's error handling identical: a
 *  typed JSON error envelope, and a single mapper from any thrown value to a
 *  semantic HTTP response. Route handlers stay thin — parse, delegate, and
 *  funnel failures through {@link mapErrorToResponse}.
 */

/** The JSON error envelope returned by every endpoint on failure. */
export interface ErrorEnvelope {
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
export function jsonError(
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
 * Maps a thrown value to a JSON response. Known {@link AppError}s surface their
 * own status/code/details; anything else is logged and returned as an opaque
 * `500` so internals never leak to the client.
 *
 * @param error   - The caught value.
 * @param context - Short label used in server-side error logs.
 * @returns A JSON error response.
 */
export function mapErrorToResponse(
  error: unknown,
  context: string,
): NextResponse<ErrorEnvelope> {
  if (error instanceof AppError) {
    return jsonError(error.status, error.code, error.message, error.details);
  }
  console.error(`[${context}] Unhandled error:`, error);
  return jsonError(
    500,
    "INTERNAL_ERROR",
    "An unexpected error occurred. Please try again.",
  );
}
