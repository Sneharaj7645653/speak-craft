import type {
  AssignmentFormat,
  AssignmentStatus,
} from "@/backend/assignment/assignment.entity";
import type { ValidationResult } from "@/backend/user/user.dto";

/**
 * @file        src/backend/assignment/assignment.dto.ts
 * @layer       DTO Layer (API boundary contracts)
 * @description
 *  Strictly-typed contracts and dependency-free validators for the assignment
 *  domain: the inbound "create & distribute assignment" request, and the
 *  outbound assignment / distribution / compliance projections.
 *
 * @remarks
 *  Validators return a {@link ValidationResult} (shared with the user domain)
 *  rather than throwing, so controllers map failures to `400` deterministically.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Inbound
// ─────────────────────────────────────────────────────────────────────────────

/** The set of accepted speaking formats, as a runtime-checkable tuple. */
export const ASSIGNMENT_FORMATS: readonly AssignmentFormat[] = [
  "extempore",
  "debate",
  "declamation",
] as const;

/** Raw create-assignment payload as it arrives on the wire, before validation. */
export interface CreateAssignmentRequestRaw {
  title?: unknown;
  formatType?: unknown;
  description?: unknown;
}

/**
 * A validated, normalised create-assignment request ready for the service.
 *
 * @property title       - Trimmed assignment title (1–200 chars).
 * @property formatType  - One of {@link ASSIGNMENT_FORMATS}.
 * @property description - Trimmed prompt body (0–5000 chars); may be empty.
 */
export interface CreateAssignmentDto {
  title: string;
  formatType: AssignmentFormat;
  description: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Outbound
// ─────────────────────────────────────────────────────────────────────────────

/** The client-facing projection of an assignment row. */
export interface AssignmentResponseDto {
  id: string;
  title: string;
  formatType: AssignmentFormat;
  description: string;
  createdAt: string;
}

/**
 * The result of publishing (distributing) an assignment to the cohort.
 *
 * @property assignment     - The created assignment.
 * @property recipientCount - Number of students the assignment was emitted to.
 */
export interface DistributionResultDto {
  assignment: AssignmentResponseDto;
  recipientCount: number;
}

/** A single student's compliance projection for the tracker table. */
export interface StudentComplianceDto {
  studentId: string;
  name: string;
  email: string;
  assignmentsAssigned: number;
  assignmentsCompleted: number;
  /** Completion ratio in [0, 1]; `0` when nothing has been assigned. */
  completionRate: number;
  totalSecondsPracticed: number;
  totalSessions: number;
}

/** Envelope for the compliance-metrics endpoint. */
export interface ComplianceReportDto {
  students: readonly StudentComplianceDto[];
  /** Cohort size reflected in the report. */
  studentCount: number;
}

/**
 * A student's view of one assignment issued to them, enriched with their
 * attempt usage against the retake guardrail.
 *
 * @property status            - Their distribution status ('assigned' | 'completed').
 * @property attemptsUsed       - Formal attempts already made.
 * @property attemptsRemaining  - Attempts left before the retake ceiling.
 * @property canAttempt         - Whether another attempt is permitted.
 */
export interface StudentAssignmentViewDto {
  id: string;
  title: string;
  formatType: AssignmentFormat;
  description: string;
  createdAt: string;
  status: AssignmentStatus;
  attemptsUsed: number;
  attemptsRemaining: number;
  canAttempt: boolean;
}

/** Envelope for the student's assignment list. */
export interface StudentAssignmentsDto {
  assignments: readonly StudentAssignmentViewDto[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Validation
// ─────────────────────────────────────────────────────────────────────────────

/** Maximum assignment title length enforced at the boundary. */
const MAX_TITLE_LENGTH = 200;

/** Maximum assignment description length enforced at the boundary. */
const MAX_DESCRIPTION_LENGTH = 5000;

/**
 * Runtime type guard: is `value` a member of {@link ASSIGNMENT_FORMATS}?
 *
 * @param value - Candidate value of unknown type.
 * @returns `true` (narrowing to {@link AssignmentFormat}) when valid.
 */
export function isAssignmentFormat(value: unknown): value is AssignmentFormat {
  return (
    typeof value === "string" &&
    (ASSIGNMENT_FORMATS as readonly string[]).includes(value)
  );
}

/**
 * Validates and normalises a raw create-assignment payload.
 *
 * @param input - The untrusted, parsed JSON body (shape unknown).
 * @returns A {@link ValidationResult}: the normalised {@link CreateAssignmentDto}
 *          on success, or the list of field errors on failure.
 */
export function validateCreateAssignmentRequest(
  input: CreateAssignmentRequestRaw | unknown,
): ValidationResult<CreateAssignmentDto> {
  const errors: string[] = [];
  const body = (input ?? {}) as CreateAssignmentRequestRaw;

  // title
  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (title.length === 0) {
    errors.push("title is required.");
  } else if (title.length > MAX_TITLE_LENGTH) {
    errors.push(`title must be at most ${MAX_TITLE_LENGTH} characters.`);
  }

  // formatType
  if (!isAssignmentFormat(body.formatType)) {
    errors.push(
      `formatType must be one of: ${ASSIGNMENT_FORMATS.join(", ")}.`,
    );
  }

  // description (optional)
  const description =
    typeof body.description === "string" ? body.description.trim() : "";
  if (description.length > MAX_DESCRIPTION_LENGTH) {
    errors.push(
      `description must be at most ${MAX_DESCRIPTION_LENGTH} characters.`,
    );
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  // Safe: guarded by isAssignmentFormat above.
  return {
    ok: true,
    value: {
      title,
      formatType: body.formatType as AssignmentFormat,
      description,
    },
  };
}

/**
 * Human-readable label for an {@link AssignmentStatus}. Small mapping helper
 * shared by outbound projections that surface status to the UI.
 *
 * @param status - The persisted lifecycle status.
 * @returns A capitalised label.
 */
export function assignmentStatusLabel(status: AssignmentStatus): string {
  return status === "completed" ? "Completed" : "Assigned";
}
