import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/lib/supabase/database.types";
import {
  AssignmentPersistenceError,
  DistributionError,
  MetricsQueryError,
} from "@/backend/instructor/instructor.errors";
import type {
  AssignmentEntity,
  AssignmentInsertEntity,
  AssignmentStatus,
  StudentAssignmentInsertEntity,
  StudentComplianceMetricEntity,
} from "@/backend/assignment/assignment.entity";

/**
 * One assignment as issued to a specific student: the assignment row joined with
 * that student's distribution status. Returned by
 * {@link AssignmentRepository.listAssignmentsForStudent}.
 */
export interface StudentAssignmentRow {
  assignment: AssignmentEntity;
  status: AssignmentStatus;
}

/**
 * @file        src/backend/assignment/assignment.repository.ts
 * @layer       Repository Layer (Data Access)
 * @description
 *  Isolated Supabase operations for the assignment domain: publishing an
 *  assignment, fanning it out to students (`student_assignments`), rolling back
 *  a failed publish, and reading the compliance metrics view.
 *
 * @remarks
 *  Uses the service-role admin client (bypasses RLS) because distribution and
 *  metrics are privileged, cohort-wide operations. Low-level driver errors are
 *  translated into typed {@link AppError}s. Server-only.
 */
export class AssignmentRepository {
  private readonly db: SupabaseClient<Database>;

  /**
   * @param client - Optional Supabase client (for testing). Defaults to the
   *                 process-level service-role admin client.
   */
  constructor(client: SupabaseClient<Database> = getSupabaseAdminClient()) {
    this.db = client;
  }

  /**
   * Inserts a new assignment row.
   *
   * @param row - The assignment to persist.
   * @returns The persisted {@link AssignmentEntity}.
   * @throws {AssignmentPersistenceError} When the insert fails.
   */
  async insertAssignment(
    row: AssignmentInsertEntity,
  ): Promise<AssignmentEntity> {
    const { data, error } = await this.db
      .from("assignments")
      .insert(row)
      .select("*")
      .single();

    if (error || !data) {
      throw new AssignmentPersistenceError(
        error?.message ?? "insert returned no row.",
      );
    }
    return data;
  }

  /**
   * Fetches a single assignment by id (used to give the AI coach context).
   *
   * @param id - The assignment's id.
   * @returns The {@link AssignmentEntity}, or `null` if not found.
   * @throws {AssignmentPersistenceError} On a read failure.
   */
  async findById(id: string): Promise<AssignmentEntity | null> {
    const { data, error } = await this.db
      .from("assignments")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (error) {
      throw new AssignmentPersistenceError(`assignment read failed: ${error.message}`);
    }
    return data;
  }

  /** Checks that an assignment has been distributed to a specific student. */
  async isAssignedToStudent(
    studentId: string,
    assignmentId: string,
  ): Promise<boolean> {
    const { data, error } = await this.db
      .from("student_assignments")
      .select("id")
      .eq("student_id", studentId)
      .eq("assignment_id", assignmentId)
      .maybeSingle();

    if (error) {
      throw new MetricsQueryError(error.message);
    }
    return data !== null;
  }

  /**
   * Deletes an assignment. Used to compensate (roll back) when the subsequent
   * distribution fan-out fails, so no assignment is left with zero recipients.
   *
   * @param assignmentId - UUID of the assignment to remove.
   * @remarks Best-effort: swallows errors so it never masks the original fault.
   */
  async deleteAssignment(assignmentId: string): Promise<void> {
    try {
      await this.db.from("assignments").delete().eq("id", assignmentId);
    } catch {
      // Intentionally ignored — compensation is best-effort.
    }
  }

  /**
   * Batch-inserts the distribution fan-out rows for an assignment.
   *
   * @param rows - One {@link StudentAssignmentInsertEntity} per recipient.
   * @returns The number of distribution rows inserted.
   * @throws {DistributionError} When the batch insert fails.
   */
  async insertStudentAssignments(
    rows: readonly StudentAssignmentInsertEntity[],
  ): Promise<number> {
    if (rows.length === 0) return 0;

    const { data, error } = await this.db
      .from("student_assignments")
      .insert(rows as StudentAssignmentInsertEntity[])
      .select("id");

    if (error) {
      throw new DistributionError(error.message);
    }
    return data?.length ?? 0;
  }

  /**
   * Reads the per-student compliance metrics view for the whole cohort.
   *
   * @returns Every student's {@link StudentComplianceMetricEntity} row.
   * @throws {MetricsQueryError} When the read fails.
   */
  async getComplianceMetrics(): Promise<StudentComplianceMetricEntity[]> {
    const { data, error } = await this.db
      .from("student_compliance_metrics")
      .select("*")
      .order("name", { ascending: true });

    if (error) {
      throw new MetricsQueryError(error.message);
    }
    return data ?? [];
  }

  /**
   * Lists the assignments issued to a specific student, newest first, each
   * paired with that student's distribution status.
   *
   * Implemented as two typed queries (distributions, then the referenced
   * assignments) merged in memory — this sidesteps nested-relationship type
   * inference and keeps both round-trips fully typed.
   *
   * @param studentId - The student's id.
   * @returns The student's {@link StudentAssignmentRow}s, newest assignment first.
   * @throws {MetricsQueryError} When either read fails.
   */
  async listAssignmentsForStudent(
    studentId: string,
  ): Promise<StudentAssignmentRow[]> {
    const { data: distributions, error: distError } = await this.db
      .from("student_assignments")
      .select("assignment_id, status")
      .eq("student_id", studentId);

    if (distError) {
      throw new MetricsQueryError(distError.message);
    }
    if (!distributions || distributions.length === 0) return [];

    const statusById = new Map<string, AssignmentStatus>(
      distributions.map((d) => [d.assignment_id, d.status]),
    );

    const { data: assignments, error: aError } = await this.db
      .from("assignments")
      .select("*")
      .in("id", [...statusById.keys()])
      .order("created_at", { ascending: false });

    if (aError) {
      throw new MetricsQueryError(aError.message);
    }

    return (assignments ?? []).map((assignment) => ({
      assignment,
      status: statusById.get(assignment.id) ?? "assigned",
    }));
  }
}
