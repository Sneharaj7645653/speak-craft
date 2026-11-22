import { NextResponse } from "next/server";

import { requireInstructor } from "@/backend/auth/authorization";
import { InstructorService } from "@/backend/instructor/instructor.service";
import { validateCreateAssignmentRequest } from "@/backend/assignment/assignment.dto";
import type { DistributionResultDto } from "@/backend/assignment/assignment.dto";
import { jsonError, mapErrorToResponse } from "@/backend/shared/http";

/**
 * @file        src/app/api/instructor/create-assignment/route.ts
 * @layer       Controller Layer (HTTP boundary — Next.js Route Handler)
 * @route        POST /api/instructor/create-assignment
 * @description
 *  Deploys an assignment specification and blasts it to the entire student
 *  cohort. Instructor-only. Transport concerns only: authorize, parse, validate,
 *  delegate to the distribution algorithm, map outcomes to status codes.
 *
 * @remarks
 *  Runs on the Node.js runtime (service-role secret) and is never cached.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Handles assignment creation + distribution.
 *
 * Input  (JSON): `{ title: string; formatType: 'extempore'|'debate'|'declamation'; description?: string }`
 * Output (201) : {@link DistributionResultDto}
 *
 * Status contract:
 *  - `201 Created`     — assignment created and distributed (result body).
 *  - `400 Bad Request` — malformed JSON or validation failure.
 *  - `401 Unauthorized`— no valid session.
 *  - `403 Forbidden`   — caller is not an instructor.
 *  - `409 Conflict`    — no enrolled students to distribute to.
 *  - `500 Internal`    — persistence / distribution / unexpected error.
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
    const validation = validateCreateAssignmentRequest(body);
    if (!validation.ok) {
      return jsonError(
        400,
        "VALIDATION_ERROR",
        "Assignment validation failed.",
        validation.errors,
      );
    }

    // 4. Delegate to the distribution algorithm.
    const service = new InstructorService();
    const result: DistributionResultDto =
      await service.createAndDistributeAssignment(validation.value);

    return NextResponse.json<DistributionResultDto>(result, { status: 201 });
  } catch (error) {
    return mapErrorToResponse(error, "POST /api/instructor/create-assignment");
  }
}
