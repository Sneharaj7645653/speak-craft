import { NextResponse } from "next/server";

import { requireStudent } from "@/backend/auth/authorization";
import { StudentService } from "@/backend/student/student.service";
import { validateHeartbeatRequest } from "@/backend/session/session.dto";
import type { HeartbeatResponseDto } from "@/backend/session/session.dto";
import { jsonError, mapErrorToResponse } from "@/backend/shared/http";

/**
 * @file        src/app/api/student/heartbeat/route.ts
 * @layer       Controller Layer (HTTP boundary — Next.js Route Handler)
 * @route        POST /api/student/heartbeat
 * @description
 *  Receives the client's 30-second heartbeat and continuously, securely
 *  aggregates practice minutes. The elapsed time credited is computed entirely
 *  server-side from the session's stored watermark — the request body carries no
 *  duration — so the accumulator cannot be inflated by a malicious or buggy
 *  client. Student-only.
 *
 * @remarks
 *  Runs on the Node.js runtime (service-role secret) and is never cached. The
 *  server clock (`new Date()`) is the single source of elapsed-time truth and is
 *  injected into the service for testability.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Handles a practice heartbeat.
 *
 * Input  (JSON): `{ sessionId: string (uuid); assignmentId?: string (uuid) }`
 * Output (200) : {@link HeartbeatResponseDto}
 *
 * Status contract:
 *  - `200 OK`          — heartbeat accepted; live totals in the body.
 *  - `400 Bad Request` — malformed JSON or validation failure.
 *  - `401 Unauthorized`— no valid session.
 *  - `403 Forbidden`   — caller is not a student, or session belongs to another user.
 *  - `409 Conflict`    — retake guardrail: no attempts remain for the assignment.
 *  - `500 Internal`    — persistence or unexpected error.
 *
 * @param request - The incoming HTTP request.
 * @returns A JSON response following the status contract above.
 */
export async function POST(request: Request): Promise<NextResponse> {
  try {
    // 1. Authorize: students only. Identity comes from the session, not the body.
    const { userId } = await requireStudent();

    // 2. Parse the body defensively.
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonError(400, "VALIDATION_ERROR", "Request body must be valid JSON.");
    }

    // 3. Validate at the DTO boundary.
    const validation = validateHeartbeatRequest(body);
    if (!validation.ok) {
      return jsonError(
        400,
        "VALIDATION_ERROR",
        "Heartbeat validation failed.",
        validation.errors,
      );
    }

    // 4. Delegate to the accumulator engine with the server clock.
    const service = new StudentService();
    const result: HeartbeatResponseDto = await service.recordHeartbeat(
      userId,
      validation.value,
      new Date(),
    );

    return NextResponse.json<HeartbeatResponseDto>(result, { status: 200 });
  } catch (error) {
    return mapErrorToResponse(error, "POST /api/student/heartbeat");
  }
}
