import "server-only";

import { AssignmentRepository } from "@/backend/assignment/assignment.repository";
import { UserRepository } from "@/backend/user/user.repository";
import { NoRecipientsError } from "@/backend/instructor/instructor.errors";
import type {
  AssignmentResponseDto,
  ComplianceReportDto,
  CreateAssignmentDto,
  DistributionResultDto,
  StudentComplianceDto,
} from "@/backend/assignment/assignment.dto";
import type {
  RosterIngestionResultDto,
  RosterUploadDto,
} from "@/backend/roster/roster.dto";
import type {
  AssignmentEntity,
  StudentAssignmentInsertEntity,
  StudentComplianceMetricEntity,
} from "@/backend/assignment/assignment.entity";

/**
 * @file        src/backend/instructor/instructor.service.ts
 * @layer       Service Layer (Business Logic)
 * @description
 *  Orchestrates the two core instructor workflows:
 *
 *   1. **Roster ingestion** — takes a validated batch of student emails parsed
 *      from a CSV/spreadsheet and inserts them into the `allowed_emails`
 *      whitelist, reporting exactly what was added, skipped, or rejected.
 *
 *   2. **Assignment distribution** — the "blast" algorithm: persist a text
 *      assignment, then fan it out to EVERY enrolled student by writing one
 *      `student_assignments` record per student. This is what makes the
 *      cohort-wide emission trackable by the compliance dashboard.
 *
 * @remarks
 *  The service is transport-agnostic: it consumes validated DTOs and returns
 *  DTOs (or throws typed {@link AppError}s). It composes both the user and
 *  assignment repositories, keeping each table's access in its owning repository.
 */
export class InstructorService {
  private readonly users: UserRepository;
  private readonly assignments: AssignmentRepository;

  /** Chunk size for the distribution insert, bounding a single round-trip. */
  private static readonly DISTRIBUTION_CHUNK_SIZE = 500;

  /**
   * @param userRepository       - Repository owning `users` / `allowed_emails`.
   * @param assignmentRepository - Repository owning the assignment domain.
   */
  constructor(
    userRepository: UserRepository = new UserRepository(),
    assignmentRepository: AssignmentRepository = new AssignmentRepository(),
  ) {
    this.users = userRepository;
    this.assignments = assignmentRepository;
  }

  /**
   * Ingests a validated roster into the campus whitelist.
   *
   * Business logic:
   *  - The DTO has already normalised, de-duplicated (within the file), and
   *    rejected malformed entries.
   *  - The repository skips emails already on the whitelist (idempotent upload).
   *  - The returned report reconciles every submitted email into exactly one
   *    bucket: added, already-whitelisted, in-file duplicate, or rejected.
   *
   * @param dto - The validated {@link RosterUploadDto}.
   * @returns A {@link RosterIngestionResultDto} summarising the outcome.
   * @throws {ProfilePersistenceError} On a database failure.
   */
  async ingestRoster(dto: RosterUploadDto): Promise<RosterIngestionResultDto> {
    const { inserted, skipped } = await this.users.bulkInsertAllowedEmails(
      dto.emails,
    );

    return {
      received: dto.emails.length,
      added: inserted.length,
      alreadyWhitelisted: skipped.length,
      duplicatesInFile: dto.duplicatesInFile,
      rejected: dto.rejected,
    };
  }

  /**
   * Creates an assignment and distributes it to the entire student cohort.
   *
   * Distribution algorithm:
   *  1. Persist the assignment (title / format / description).
   *  2. Resolve every enrolled student id.
   *  3. If there are no students, COMPENSATE by deleting the assignment and
   *     raise {@link NoRecipientsError} — we never leave an orphan with zero
   *     recipients.
   *  4. Build one `student_assignments` row per student (status 'assigned') and
   *     insert them in bounded chunks.
   *  5. On any distribution failure, COMPENSATE by deleting the assignment and
   *     rethrow, so a partially-distributed assignment is never left behind.
   *
   * @param dto - The validated {@link CreateAssignmentDto}.
   * @returns A {@link DistributionResultDto} with the assignment and recipient count.
   * @throws {NoRecipientsError}          When there are no students.
   * @throws {AssignmentPersistenceError} When the assignment insert fails.
   * @throws {DistributionError}          When the fan-out insert fails.
   */
  async createAndDistributeAssignment(
    dto: CreateAssignmentDto,
  ): Promise<DistributionResultDto> {
    // 1. Persist the assignment.
    const assignment = await this.assignments.insertAssignment({
      title: dto.title,
      format_type: dto.formatType,
      description: dto.description,
    });

    try {
      // 2. Resolve recipients.
      const studentIds = await this.users.listStudentIds();

      // 3. No recipients → roll back and signal.
      if (studentIds.length === 0) {
        await this.assignments.deleteAssignment(assignment.id);
        throw new NoRecipientsError();
      }

      // 4. Fan out in bounded chunks.
      const rows: StudentAssignmentInsertEntity[] = studentIds.map(
        (studentId) => ({
          assignment_id: assignment.id,
          student_id: studentId,
          status: "assigned",
        }),
      );

      let recipientCount = 0;
      for (const chunk of InstructorService.chunk(
        rows,
        InstructorService.DISTRIBUTION_CHUNK_SIZE,
      )) {
        recipientCount += await this.assignments.insertStudentAssignments(chunk);
      }

      return {
        assignment: this.toAssignmentDto(assignment),
        recipientCount,
      };
    } catch (error) {
      // 5. Compensate: an assignment with a broken/empty fan-out must not survive.
      await this.assignments.deleteAssignment(assignment.id);
      throw error;
    }
  }

  /**
   * Builds the cohort compliance report for the tracker.
   *
   * @returns A {@link ComplianceReportDto} of per-student progress metrics.
   * @throws {MetricsQueryError} When the metrics read fails.
   */
  async getComplianceReport(): Promise<ComplianceReportDto> {
    const rows = await this.assignments.getComplianceMetrics();
    const students = rows.map((row) => this.toComplianceDto(row));
    return { students, studentCount: students.length };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Mapping helpers (entity → DTO)
  // ───────────────────────────────────────────────────────────────────────────

  /** Maps a persisted assignment row to its outbound DTO. */
  private toAssignmentDto(entity: AssignmentEntity): AssignmentResponseDto {
    return {
      id: entity.id,
      title: entity.title,
      formatType: entity.format_type,
      description: entity.description,
      createdAt: entity.created_at,
    };
  }

  /** Maps a compliance view row to its outbound DTO, computing completion rate. */
  private toComplianceDto(
    row: StudentComplianceMetricEntity,
  ): StudentComplianceDto {
    const completionRate =
      row.assignments_assigned > 0
        ? row.assignments_completed / row.assignments_assigned
        : 0;

    return {
      studentId: row.student_id,
      name: row.name,
      email: row.email,
      assignmentsAssigned: row.assignments_assigned,
      assignmentsCompleted: row.assignments_completed,
      completionRate,
      totalSecondsPracticed: row.total_seconds_practiced,
      totalSessions: row.total_sessions,
    };
  }

  /**
   * Splits an array into fixed-size chunks.
   *
   * @param items - The source array.
   * @param size  - Maximum chunk length (> 0).
   * @returns An array of chunks preserving order.
   */
  private static chunk<T>(items: readonly T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < items.length; i += size) {
      chunks.push(items.slice(i, i + size));
    }
    return chunks;
  }
}
