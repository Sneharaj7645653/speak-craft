import { AppError } from "@/backend/shared/app-error";

/**
 * @file        src/backend/user/user.errors.ts
 * @layer       Domain (cross-cutting)
 * @description
 *  Typed domain errors shared by the repository and service layers. Each error
 *  carries a stable, machine-readable `code` and the semantic HTTP `status` the
 *  controller should emit. This lets the controller translate business outcomes
 *  to status codes without leaking layer-specific details or `instanceof`
 *  chains into transport concerns.
 *
 * @remarks
 *  These extend the shared {@link AppError} base so every route handler — Phase 1
 *  and Phase 2 alike — can catch and map failures at a single point.
 */

/** Stable, client-facing error codes for the user/auth domain. */
export type UserErrorCode =
  | "VALIDATION_ERROR"
  | "EMAIL_NOT_WHITELISTED"
  | "EMAIL_ALREADY_REGISTERED"
  | "AUTH_PROVIDER_ERROR"
  | "PROFILE_PERSISTENCE_ERROR"
  | "INTERNAL_ERROR";

/**
 * Base class for all domain errors in the user/auth bounded context.
 *
 * @property code    - Stable machine-readable identifier for the failure.
 * @property status  - Semantic HTTP status the controller should return.
 * @property details - Optional human-readable specifics (e.g. field errors).
 */
export class UserDomainError extends AppError {
  /**
   * @param code    - Stable error code (from the user-domain union).
   * @param status  - HTTP status to surface.
   * @param message - Developer-facing message (safe to log).
   * @param details - Optional list of client-safe detail strings.
   */
  constructor(
    code: UserErrorCode,
    status: number,
    message: string,
    details?: readonly string[],
  ) {
    super(code, status, message, details);
    this.name = "UserDomainError";
  }
}

/** Input failed DTO validation. → 400 */
export class ValidationError extends UserDomainError {
  constructor(details: readonly string[]) {
    super("VALIDATION_ERROR", 400, "Request validation failed.", details);
    this.name = "ValidationError";
  }
}

/** Email is absent from the campus whitelist. → 403 */
export class EmailNotWhitelistedError extends UserDomainError {
  constructor(email: string) {
    super(
      "EMAIL_NOT_WHITELISTED",
      403,
      `Email "${email}" is not on the campus whitelist.`,
    );
    this.name = "EmailNotWhitelistedError";
  }
}

/** A user with this email already exists in the auth provider. → 409 */
export class EmailAlreadyRegisteredError extends UserDomainError {
  constructor(email: string) {
    super(
      "EMAIL_ALREADY_REGISTERED",
      409,
      `Email "${email}" is already registered.`,
    );
    this.name = "EmailAlreadyRegisteredError";
  }
}

/** Supabase Auth rejected the sign-up for a reason other than duplication. → 502 */
export class AuthProviderError extends UserDomainError {
  constructor(message: string) {
    super("AUTH_PROVIDER_ERROR", 502, `Auth provider error: ${message}`);
    this.name = "AuthProviderError";
  }
}

/** The auth identity was created but the profile row could not be persisted. → 500 */
export class ProfilePersistenceError extends UserDomainError {
  constructor(message: string) {
    super(
      "PROFILE_PERSISTENCE_ERROR",
      500,
      `Failed to persist user profile: ${message}`,
    );
    this.name = "ProfilePersistenceError";
  }
}
