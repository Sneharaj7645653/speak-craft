import type { UserRole } from "@/backend/user/user.entity";

/**
 * @file        src/backend/user/user.dto.ts
 * @layer       DTO Layer (API boundary contracts)
 * @description
 *  Strictly-typed interfaces and runtime validators for data ENTERING and
 *  LEAVING the API boundary. DTOs are the anti-corruption layer between
 *  untrusted HTTP input and the typed core: nothing reaches the service layer
 *  without first being validated here.
 *
 * @remarks
 *  Validation is implemented with hand-rolled, dependency-free guards so the
 *  backend has no runtime schema library requirement in Phase 1. Each validator
 *  returns a discriminated {@link ValidationResult} rather than throwing, so the
 *  controller can map failures to a `400` deterministically.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Inbound DTOs
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Raw signup payload as it arrives on the wire, before validation.
 * All fields are `unknown` — never trust the client.
 */
export interface SignupRequestRaw {
  email?: unknown;
  password?: unknown;
  name?: unknown;
}

/**
 * A validated, normalised signup request ready for the service layer.
 *
 * @property email    - Lower-cased, trimmed, syntactically-valid address.
 * @property password - Plaintext password (≥ 8 chars). Never logged, never stored;
 *                      handed directly to Supabase Auth which hashes it.
 * @property name     - Trimmed display name (1–120 chars).
 */
export interface SignupRequestDto {
  email: string;
  password: string;
  name: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Outbound DTOs
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The user projection returned to clients. Deliberately excludes any sensitive
 * or internal-only field. Serialised as JSON in the API response.
 *
 * @property id        - The user's UUID.
 * @property email     - The user's email.
 * @property name      - The user's display name.
 * @property role      - The user's role.
 * @property createdAt - ISO-8601 creation timestamp (camelCase at the boundary).
 */
export interface UserResponseDto {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  createdAt: string;
}

/** Standard success envelope for the signup endpoint. */
export interface SignupResponseDto {
  user: UserResponseDto;
}

// ─────────────────────────────────────────────────────────────────────────────
// Validation primitives
// ─────────────────────────────────────────────────────────────────────────────

/** Discriminated result of a DTO validation attempt. */
export type ValidationResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly errors: readonly string[] };

/**
 * Pragmatic email syntax check. Intentionally conservative — the whitelist and
 * Supabase Auth are the real gatekeepers; this merely rejects obvious garbage.
 */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Minimum password length enforced at the boundary. */
const MIN_PASSWORD_LENGTH = 8;

/** Maximum display-name length enforced at the boundary. */
const MAX_NAME_LENGTH = 120;

/**
 * Validates and normalises a raw signup payload into a {@link SignupRequestDto}.
 *
 * @param input - The untrusted, parsed JSON body (shape unknown).
 * @returns A {@link ValidationResult}: `ok:true` with the normalised DTO, or
 *          `ok:false` with a list of human-readable field errors.
 *
 * @example
 * const result = validateSignupRequest(await req.json());
 * if (!result.ok) return badRequest(result.errors);
 * // result.value is a SignupRequestDto
 */
export function validateSignupRequest(
  input: SignupRequestRaw | unknown,
): ValidationResult<SignupRequestDto> {
  const errors: string[] = [];
  const body = (input ?? {}) as SignupRequestRaw;

  // email
  const emailRaw = typeof body.email === "string" ? body.email.trim() : "";
  const email = emailRaw.toLowerCase();
  if (email.length === 0) {
    errors.push("email is required.");
  } else if (!EMAIL_PATTERN.test(email)) {
    errors.push("email is not a valid address.");
  }

  // password
  const password = typeof body.password === "string" ? body.password : "";
  if (password.length === 0) {
    errors.push("password is required.");
  } else if (password.length < MIN_PASSWORD_LENGTH) {
    errors.push(`password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  }

  // name
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (name.length === 0) {
    errors.push("name is required.");
  } else if (name.length > MAX_NAME_LENGTH) {
    errors.push(`name must be at most ${MAX_NAME_LENGTH} characters.`);
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return { ok: true, value: { email, password, name } };
}
