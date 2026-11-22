import { AppError } from "@/backend/shared/app-error";

/**
 * @file        src/backend/ai/ai.errors.ts
 * @layer       Domain (AI coach bounded context)
 * @description
 *  Typed errors for the AI coaching domain. All extend the shared
 *  {@link AppError} so controllers map them uniformly to responses.
 */

/** Persisting the evaluation record failed. → 500 */
export class EvaluationPersistenceError extends AppError {
  constructor(message: string) {
    super(
      "EVALUATION_PERSISTENCE_ERROR",
      500,
      `Failed to persist evaluation: ${message}`,
    );
    this.name = "EvaluationPersistenceError";
  }
}

/**
 * Neither AI provider is configured (both API keys missing). → 503
 * Raised only when there is genuinely no way to serve the stream.
 */
export class CoachUnavailableError extends AppError {
  constructor() {
    super(
      "COACH_UNAVAILABLE",
      503,
      "The AI coaching service is not configured. Please contact your administrator.",
    );
    this.name = "CoachUnavailableError";
  }
}
