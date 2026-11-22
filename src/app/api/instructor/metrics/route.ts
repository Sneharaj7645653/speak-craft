import { NextResponse } from "next/server";

import { requireInstructor } from "@/backend/auth/authorization";
import { InstructorService } from "@/backend/instructor/instructor.service";
import type { ComplianceReportDto } from "@/backend/assignment/assignment.dto";
import { mapErrorToResponse } from "@/backend/shared/http";

/**
 * @file        src/app/api/instructor/metrics/route.ts
 * @layer       Controller Layer (HTTP boundary — Next.js Route Handler)
 * @route        GET /api/instructor/metrics
 * @description
 *  Serves the cohort compliance report that backs the dashboard's progress
 *  tracker. Instructor-only, read-only. Delegates aggregation to the service /
 *  compliance view; the controller merely authorizes and shapes the response.
 *
 * @remarks
 *  Runs on the Node.js runtime (service-role secret) and is never cached so the
 *  tracker always reflects current progress.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Returns the per-student compliance report.
 *
 * Output (200): {@link ComplianceReportDto}
 *
 * Status contract:
 *  - `200 OK`          — report body.
 *  - `401 Unauthorized`— no valid session.
 *  - `403 Forbidden`   — caller is not an instructor.
 *  - `500 Internal`    — metrics query / unexpected error.
 *
 * @returns A JSON response following the status contract above.
 */
export async function GET(): Promise<NextResponse> {
  try {
    await requireInstructor();

    const service = new InstructorService();
    const report: ComplianceReportDto = await service.getComplianceReport();

    return NextResponse.json<ComplianceReportDto>(report, { status: 200 });
  } catch (error) {
    return mapErrorToResponse(error, "GET /api/instructor/metrics");
  }
}
