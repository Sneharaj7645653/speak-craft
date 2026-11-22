import { NextResponse } from "next/server";

import { requireStudent } from "@/backend/auth/authorization";
import { StudentService } from "@/backend/student/student.service";
import type { StudentAssignmentsDto } from "@/backend/assignment/assignment.dto";
import { mapErrorToResponse } from "@/backend/shared/http";

/**
 * @file        src/app/api/student/assignments/route.ts
 * @layer       Controller Layer (HTTP boundary — Next.js Route Handler)
 * @route        GET /api/student/assignments
 * @description
 *  Lists the assignments issued to the caller, each enriched with attempt usage
 *  against the retake guardrail. Backs the dashboard's assignment cards.
 *  Student-only.
 *
 * @remarks Node.js runtime; never cached.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Returns the caller's assignments.
 *
 * Output (200): {@link StudentAssignmentsDto}
 *
 * Status contract: `200` on success; `401` unauthenticated; `403` non-student;
 * `500` on an unexpected error.
 *
 * @returns A JSON response following the status contract above.
 */
export async function GET(): Promise<NextResponse> {
  try {
    const { userId } = await requireStudent();

    const service = new StudentService();
    const result: StudentAssignmentsDto = await service.getAssignments(userId);

    return NextResponse.json<StudentAssignmentsDto>(result, { status: 200 });
  } catch (error) {
    return mapErrorToResponse(error, "GET /api/student/assignments");
  }
}
