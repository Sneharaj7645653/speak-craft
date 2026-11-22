import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/lib/supabase/database.types";
import {
  AuthProviderError,
  EmailAlreadyRegisteredError,
  ProfilePersistenceError,
} from "@/backend/user/user.errors";
import type {
  AllowedEmailEntity,
  UserEntity,
  UserInsertEntity,
} from "@/backend/user/user.entity";

/**
 * @file        src/backend/user/user.repository.ts
 * @layer       Repository Layer (Data Access)
 * @description
 *  Isolated, side-effecting database operations against Supabase. This is the
 *  ONLY layer permitted to talk to the persistence infrastructure. It exposes
 *  intention-revealing methods (`findAllowedEmail`, `createAuthUser`, …) and
 *  hides all query mechanics from the service layer.
 *
 * @remarks
 *  Uses the service-role admin client, which bypasses RLS — required to read
 *  `allowed_emails` and to provision auth identities. Low-level Supabase errors
 *  are translated into typed {@link UserDomainError}s so callers never inspect
 *  raw driver errors. This module is server-only.
 */
export class UserRepository {
  private readonly db: SupabaseClient<Database>;

  /**
   * @param client - Optional Supabase client (primarily for testing). Defaults
   *                 to the process-level service-role admin client.
   */
  constructor(client: SupabaseClient<Database> = getSupabaseAdminClient()) {
    this.db = client;
  }

  /**
   * Looks up a whitelist entry by email (case-insensitive).
   *
   * @param email - Normalised (lower-cased, trimmed) email address.
   * @returns The matching {@link AllowedEmailEntity}, or `null` if not present.
   * @throws {ProfilePersistenceError} On an unexpected database read failure.
   */
  async findAllowedEmail(email: string): Promise<AllowedEmailEntity | null> {
    const { data, error } = await this.db
      .from("allowed_emails")
      .select("*")
      .ilike("email", email)
      .maybeSingle();

    if (error) {
      throw new ProfilePersistenceError(
        `whitelist lookup failed: ${error.message}`,
      );
    }
    return data;
  }

  /**
   * Creates an auth identity in Supabase Auth with the email pre-confirmed.
   *
   * @param params - Signup credentials plus metadata to attach to the identity.
   * @returns The newly-created auth user's UUID.
   * @throws {EmailAlreadyRegisteredError} When the email already has an identity.
   * @throws {AuthProviderError}           On any other auth provider failure.
   */
  async createAuthUser(params: {
    email: string;
    password: string;
    name: string;
  }): Promise<{ id: string }> {
    const { data, error } = await this.db.auth.admin.createUser({
      email: params.email,
      password: params.password,
      email_confirm: true,
      user_metadata: { name: params.name },
    });

    if (error) {
      // Supabase surfaces duplicate registrations with a 4xx status / message.
      const message = error.message.toLowerCase();
      if (
        error.status === 422 ||
        message.includes("already registered") ||
        message.includes("already been registered") ||
        message.includes("already exists")
      ) {
        throw new EmailAlreadyRegisteredError(params.email);
      }
      throw new AuthProviderError(error.message);
    }

    if (!data.user) {
      throw new AuthProviderError("auth provider returned no user.");
    }
    return { id: data.user.id };
  }

  /**
   * Deletes an auth identity. Used to compensate (roll back) when the profile
   * insert fails after the identity was already created.
   *
   * @param userId - UUID of the auth identity to remove.
   * @remarks Best-effort: swallows errors so it never masks the original fault.
   */
  async deleteAuthUser(userId: string): Promise<void> {
    try {
      await this.db.auth.admin.deleteUser(userId);
    } catch {
      // Intentionally ignored — compensation is best-effort.
    }
  }

  /**
   * Inserts the application profile row keyed to the auth identity.
   *
   * @param row - The fully-formed {@link UserInsertEntity} to persist.
   * @returns The persisted {@link UserEntity} as stored.
   * @throws {ProfilePersistenceError} When the insert fails.
   */
  async insertUserProfile(row: UserInsertEntity): Promise<UserEntity> {
    const { data, error } = await this.db
      .from("users")
      .insert(row)
      .select("*")
      .single();

    if (error || !data) {
      throw new ProfilePersistenceError(
        error?.message ?? "insert returned no row.",
      );
    }
    return data;
  }

  /**
   * Fetches a profile row by id.
   *
   * @param id - The user's UUID.
   * @returns The {@link UserEntity}, or `null` if none exists.
   * @throws {ProfilePersistenceError} On an unexpected read failure.
   */
  async findUserById(id: string): Promise<UserEntity | null> {
    const { data, error } = await this.db
      .from("users")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (error) {
      throw new ProfilePersistenceError(
        `profile lookup failed: ${error.message}`,
      );
    }
    return data;
  }

  /**
   * Batch-inserts campus whitelist emails, skipping any already present.
   *
   * Rather than relying on an ON CONFLICT target against the expression index,
   * this reads the intersection with existing rows first and inserts only the
   * genuinely new emails — yielding precise inserted/skipped accounting for the
   * roster ingestion report. Emails MUST be pre-normalised (lower-cased) by the
   * caller, matching the storage invariant from Phase 1.
   *
   * @param normalizedEmails - Unique, lower-cased emails to add to the whitelist.
   * @returns The emails actually inserted and those skipped as pre-existing.
   * @throws {ProfilePersistenceError} On a read or write failure.
   */
  async bulkInsertAllowedEmails(
    normalizedEmails: readonly string[],
  ): Promise<{ inserted: string[]; skipped: string[] }> {
    if (normalizedEmails.length === 0) {
      return { inserted: [], skipped: [] };
    }

    // 1. Find which of these emails already exist on the whitelist.
    const { data: existingRows, error: readError } = await this.db
      .from("allowed_emails")
      .select("email")
      .in("email", normalizedEmails as string[]);

    if (readError) {
      throw new ProfilePersistenceError(
        `whitelist pre-read failed: ${readError.message}`,
      );
    }

    const existing = new Set((existingRows ?? []).map((r) => r.email));
    const toInsert = normalizedEmails.filter((e) => !existing.has(e));
    const skipped = normalizedEmails.filter((e) => existing.has(e));

    // 2. Insert only the new emails.
    if (toInsert.length > 0) {
      const { error: writeError } = await this.db
        .from("allowed_emails")
        .insert(toInsert.map((email) => ({ email })));

      if (writeError) {
        throw new ProfilePersistenceError(
          `whitelist batch insert failed: ${writeError.message}`,
        );
      }
    }

    return { inserted: toInsert, skipped };
  }

  /**
   * Lists the ids of all enrolled students (role = 'student').
   *
   * @returns An array of student UUIDs (may be empty).
   * @throws {ProfilePersistenceError} On a read failure.
   */
  async listStudentIds(): Promise<string[]> {
    const { data, error } = await this.db
      .from("users")
      .select("id")
      .eq("role", "student");

    if (error) {
      throw new ProfilePersistenceError(
        `student roster read failed: ${error.message}`,
      );
    }
    return (data ?? []).map((r) => r.id);
  }
}
