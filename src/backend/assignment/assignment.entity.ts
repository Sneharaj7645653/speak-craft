import type {
  AssignmentFormatEnum,
  AssignmentStatusEnum,
  Database,
} from "@/lib/supabase/database.types";

/**
 * @file        src/backend/assignment/assignment.entity.ts
 * @layer       Entity Layer (Persistence)
 * @description
 *  Defines the EXACT structure of assignment-domain rows as stored in Supabase:
 *  the `assignments` table, its per-student distribution fan-out
 *  (`student_assignments`), and the `student_compliance_metrics` read-model view.
 *
 * @remarks
 *  Entities model persistence, not the API surface. The service layer maps them
 *  to DTOs before anything crosses the HTTP boundary.
 */

/** Re-export of the speaking-format enum, sourced from the DB type contract. */
export type AssignmentFormat = AssignmentFormatEnum;

/** Re-export of the per-student assignment lifecycle status. */
export type AssignmentStatus = AssignmentStatusEnum;

/** An `assignments` row exactly as stored in and returned from Supabase. */
export type AssignmentEntity = Database["public"]["Tables"]["assignments"]["Row"];

/** The insert shape accepted by the `assignments` table (defaults optional). */
export type AssignmentInsertEntity =
  Database["public"]["Tables"]["assignments"]["Insert"];

/** A `student_assignments` (distribution) row as stored in Supabase. */
export type StudentAssignmentEntity =
  Database["public"]["Tables"]["student_assignments"]["Row"];

/** The insert shape for a single distribution fan-out row. */
export type StudentAssignmentInsertEntity =
  Database["public"]["Tables"]["student_assignments"]["Insert"];

/**
 * A row from the `student_compliance_metrics` view: the per-student roll-up of
 * assignment compliance and total practice time consumed by the tracker.
 */
export type StudentComplianceMetricEntity =
  Database["public"]["Views"]["student_compliance_metrics"]["Row"];
