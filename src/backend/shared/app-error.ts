/**
 * @file        src/backend/shared/app-error.ts
 * @layer       Domain (cross-cutting foundation)
 * @description
 *  The single base class for every typed error raised by the backend. Each
 *  error carries a stable machine-readable `code`, the semantic HTTP `status`
 *  the controller should emit, and optional client-safe `details`. Controllers
 *  translate `AppError` instances to responses uniformly, so no layer needs to
 *  know transport specifics and no `instanceof` ladder is required per domain.
 *
 * @remarks
 *  Phase 1's `UserDomainError` and Phase 2's instructor/authorization errors all
 *  extend this class, giving one catch-and-map point in every route handler.
 */
export class AppError extends Error {
  /** Stable, client-facing machine-readable identifier for the failure. */
  public readonly code: string;
  /** Semantic HTTP status the controller should return. */
  public readonly status: number;
  /** Optional list of client-safe detail strings (e.g. field errors). */
  public readonly details?: readonly string[];

  /**
   * @param code    - Stable error code.
   * @param status  - HTTP status to surface.
   * @param message - Developer-facing message (safe to log).
   * @param details - Optional list of client-safe detail strings.
   */
  constructor(
    code: string,
    status: number,
    message: string,
    details?: readonly string[],
  ) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

/** The caller is not authenticated (no / invalid session). → 401 */
export class UnauthorizedError extends AppError {
  constructor(message = "Authentication is required.") {
    super("UNAUTHORIZED", 401, message);
    this.name = "UnauthorizedError";
  }
}

/** The caller is authenticated but lacks the required role/permission. → 403 */
export class ForbiddenError extends AppError {
  constructor(message = "You do not have permission to perform this action.") {
    super("FORBIDDEN", 403, message);
    this.name = "ForbiddenError";
  }
}

/** Generic input validation failure at the API boundary. → 400 */
export class BadRequestError extends AppError {
  constructor(message: string, details?: readonly string[]) {
    super("VALIDATION_ERROR", 400, message, details);
    this.name = "BadRequestError";
  }
}
