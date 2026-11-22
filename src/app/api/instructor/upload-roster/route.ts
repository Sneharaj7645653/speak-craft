import { NextResponse } from "next/server";

import { requireInstructor } from "@/backend/auth/authorization";
import { InstructorService } from "@/backend/instructor/instructor.service";
import { validateRosterUpload } from "@/backend/roster/roster.dto";
import type { RosterIngestionResultDto } from "@/backend/roster/roster.dto";
import { jsonError, mapErrorToResponse } from "@/backend/shared/http";

/**
 * @file        src/app/api/instructor/upload-roster/route.ts
 * @layer       Controller Layer (HTTP boundary — Next.js Route Handler)
 * @route        POST /api/instructor/upload-roster
 * @description
 *  Ingests a roster upload (raw CSV text or a pre-parsed email array) into the
 *  campus whitelist. Instructor-only. Transport concerns only: authorize, parse,
 *  validate via the DTO, delegate to the service, map outcomes to status codes.
 *
 * @remarks
 *  Runs on the Node.js runtime (service-role secret) and is never cached.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Handles a roster upload.
 *
 * Input  (JSON): `{ csv: string }` OR `{ emails: string[] }`
 * Output (200) : {@link RosterIngestionResultDto}
 *
 * Status contract:
 *  - `200 OK`          — ingestion completed (report body).
 *  - `400 Bad Request` — malformed JSON or roster validation failure.
 *  - `401 Unauthorized`— no valid session.
 *  - `403 Forbidden`   — caller is not an instructor.
 *  - `500 Internal`    — persistence or unexpected error.
 *
 * @param request - The incoming HTTP request.
 * @returns A JSON response following the status contract above.
 */
export async function POST(request: Request): Promise<NextResponse> {
  try {
    // 1. Authorize: instructors only.
    await requireInstructor();

    // 2. Parse the body defensively.
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonError(400, "VALIDATION_ERROR", "Request body must be valid JSON.");
    }

    // 3. Validate & normalise at the DTO boundary.
    const validation = validateRosterUpload(body);
    if (!validation.ok) {
      return jsonError(
        400,
        "VALIDATION_ERROR",
        "Roster validation failed.",
        validation.errors,
      );
    }

    // 4. Delegate to the service.
    const service = new InstructorService();
    const result: RosterIngestionResultDto = await service.ingestRoster(
      validation.value,
    );

    return NextResponse.json<RosterIngestionResultDto>(result, { status: 200 });
  } catch (error) {
    return mapErrorToResponse(error, "POST /api/instructor/upload-roster");
  }
}
