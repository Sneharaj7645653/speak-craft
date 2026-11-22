import { NextResponse } from "next/server";

import { requireStudent } from "@/backend/auth/authorization";
import { StudentService } from "@/backend/student/student.service";
import type { StreakSummaryDto } from "@/backend/session/streak.dto";
import { mapErrorToResponse } from "@/backend/shared/http";

/**
 * @file        src/app/api/student/streak/route.ts
 * @layer       Controller Layer (HTTP boundary — Next.js Route Handler)
 * @route        GET /api/student/streak
 * @description
 *  Serves the gamified streak summary (current / longest consecutive-day streaks
 *  and today's progress) for the dashboard's tracking block. Student-only.
 *
 * @remarks Node.js runtime; never cached so the streak reflects live progress.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Returns the caller's streak summary.
 *
 * Output (200): {@link StreakSummaryDto}
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
    const summary: StreakSummaryDto = await service.getStreakSummary(
      userId,
      new Date(),
    );

    return NextResponse.json<StreakSummaryDto>(summary, { status: 200 });
  } catch (error) {
    return mapErrorToResponse(error, "GET /api/student/streak");
  }
}
