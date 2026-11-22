import { AppError } from "@/backend/shared/app-error";

/**
 * @file        src/backend/instructor/instructor.errors.ts
 * @layer       Domain (instructor bounded context)
 * @description
 *  Typed errors for roster ingestion and assignment distribution. All extend
 *  the shared {@link AppError} so controllers map them uniformly to responses.
 */

/** A roster batch insert into `allowed_emails` failed. → 500 */
export class RosterPersistenceError extends AppError {
  constructor(message: string) {
    super("ROSTER_PERSISTENCE_ERROR", 500, `Roster ingestion failed: ${message}`);
    this.name = "RosterPersistenceError";
  }
}

/** Persisting the assignment record failed. → 500 */
export class AssignmentPersistenceError extends AppError {
  constructor(message: string) {
    super(
      "ASSIGNMENT_PERSISTENCE_ERROR",
      500,
      `Assignment persistence failed: ${message}`,
    );
    this.name = "AssignmentPersistenceError";
  }
}

/** The assignment was created but distributing it to students failed. → 500 */
export class DistributionError extends AppError {
  constructor(message: string) {
    super("DISTRIBUTION_ERROR", 500, `Assignment distribution failed: ${message}`);
    this.name = "DistributionError";
  }
}

/** There are no students to distribute an assignment to. → 409 */
export class NoRecipientsError extends AppError {
  constructor() {
    super(
      "NO_RECIPIENTS",
      409,
      "There are no enrolled students to distribute this assignment to.",
    );
    this.name = "NoRecipientsError";
  }
}

/** Reading the compliance metrics view failed. → 500 */
export class MetricsQueryError extends AppError {
  constructor(message: string) {
    super("METRICS_QUERY_ERROR", 500, `Failed to read compliance metrics: ${message}`);
    this.name = "MetricsQueryError";
  }
}
