import { AppError } from "@/backend/shared/app-error";

/**
 * @file        src/backend/student/student.errors.ts
 * @layer       Domain (student bounded context)
 * @description
 *  Typed errors for the student session engine. All extend the shared
 *  {@link AppError} so controllers map them uniformly to responses.
 */

/** The retake guardrail was hit: no attempts remain for this assignment. → 409 */
export class RetakeLimitExceededError extends AppError {
  constructor(maxAttempts: number) {
    super(
      "RETAKE_LIMIT_EXCEEDED",
      409,
      `Attempt limit reached: a maximum of ${maxAttempts} attempts is allowed per assignment.`,
    );
    this.name = "RetakeLimitExceededError";
  }
}

/** A heartbeat referenced a session owned by a different student. → 403 */
export class SessionOwnershipError extends AppError {
  constructor() {
    super(
      "SESSION_FORBIDDEN",
      403,
      "This speaking session does not belong to the current user.",
    );
    this.name = "SessionOwnershipError";
  }
}

/** A session-engine persistence operation failed. → 500 */
export class SessionPersistenceError extends AppError {
  constructor(message: string) {
    super("SESSION_PERSISTENCE_ERROR", 500, `Session persistence failed: ${message}`);
    this.name = "SessionPersistenceError";
  }
}

/** The referenced assignment does not exist. → 404 */
export class AssignmentNotFoundError extends AppError {
  constructor() {
    super("ASSIGNMENT_NOT_FOUND", 404, "The referenced assignment was not found.");
    this.name = "AssignmentNotFoundError";
  }
}
