import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ForbiddenError, UnauthorizedError } from "@/backend/shared/app-error";
import { UserRepository } from "@/backend/user/user.repository";
import type { UserRole } from "@/backend/user/user.entity";

/**
 * @file        src/backend/auth/authorization.ts
 * @layer       Service (cross-cutting authorization)
 * @description
 *  Request-scoped authorization guards. These sit between the controller and the
 *  business services, establishing WHO the caller is and WHETHER they may act.
 *  All mutating instructor endpoints (roster ingestion, assignment blast) run
 *  through {@link requireInstructor} so no privileged operation is ever exposed
 *  to students or anonymous callers.
 *
 * @remarks
 *  Identity is derived from the verified Supabase session (`auth.getUser()`
 *  validates the JWT against the auth server — it does not trust the cookie
 *  blindly). The role is read from the caller's own `users` row via the
 *  RLS-constrained server client, relying on the `users_select_self` policy from
 *  migration 0001.
 */

/** The authenticated caller's identity and role, resolved from their session. */
export interface AuthContext {
  /** The caller's UUID (equals `auth.users.id`). */
  readonly userId: string;
  /** The caller's application role. */
  readonly role: UserRole;
  /** The caller's email. */
  readonly email: string;
}

/**
 * Resolves the current authenticated caller, or throws if unauthenticated.
 *
 * @returns The caller's {@link AuthContext}.
 * @throws {UnauthorizedError} When there is no valid session or no profile row.
 */
export async function requireAuth(
  repository: UserRepository = new UserRepository(),
): Promise<AuthContext> {
  const supabase = createSupabaseServerClient();

  // getUser() validates the JWT against the auth server — it does not blindly
  // trust the cookie contents.
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    throw new UnauthorizedError();
  }

  // The identity is verified; resolve the role from the profile row via the
  // typed repository (keyed by the verified user id).
  const profile = await repository.findUserById(user.id);
  if (!profile) {
    throw new UnauthorizedError(
      "No application profile is linked to this account.",
    );
  }

  return { userId: profile.id, role: profile.role, email: profile.email };
}

/**
 * Resolves the caller and asserts they hold the `instructor` role.
 *
 * @returns The instructor's {@link AuthContext}.
 * @throws {UnauthorizedError} When there is no valid session.
 * @throws {ForbiddenError}    When the caller is authenticated but not an instructor.
 */
export async function requireInstructor(): Promise<AuthContext> {
  const context = await requireAuth();
  if (context.role !== "instructor") {
    throw new ForbiddenError("Instructor privileges are required.");
  }
  return context;
}

/**
 * Resolves the caller and asserts they hold the `student` role.
 *
 * @returns The student's {@link AuthContext}.
 * @throws {UnauthorizedError} When there is no valid session.
 * @throws {ForbiddenError}    When the caller is authenticated but not a student.
 */
export async function requireStudent(): Promise<AuthContext> {
  const context = await requireAuth();
  if (context.role !== "student") {
    throw new ForbiddenError("This action is only available to students.");
  }
  return context;
}
