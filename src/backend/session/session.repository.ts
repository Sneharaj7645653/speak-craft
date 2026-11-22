import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/lib/supabase/database.types";
import {
  RetakeLimitExceededError,
  SessionOwnershipError,
  SessionPersistenceError,
} from "@/backend/student/student.errors";
import { ForbiddenError } from "@/backend/shared/app-error";
import type {
  PracticeDayEntity,
  SpeakingSessionEntity,
  SpeakingSessionInsertEntity,
  SpeakingSessionUpdateEntity,
} from "@/backend/session/session.entity";

/**
 * @file        src/backend/session/session.repository.ts
 * @layer       Repository Layer (Data Access)
 * @description
 *  Isolated Supabase operations for the session engine: reading/creating/updating
 *  `speaking_sessions`, counting attempts for the retake guardrail, and
 *  upserting + aggregating the `practice_sessions` daily accumulator and its
 *  history for the streak engine.
 *
 * @remarks
 *  Uses the service-role admin client (bypasses RLS); the heartbeat endpoint has
 *  already authenticated the caller and always scopes writes to the verified
 *  student id. Low-level errors are translated to {@link SessionPersistenceError}.
 *  Server-only.
 */
export class SessionRepository {
  private readonly db: SupabaseClient<Database>;

  /**
   * @param client - Optional Supabase client (for testing). Defaults to the
   *                 process-level service-role admin client.
   */
  constructor(client: SupabaseClient<Database> = getSupabaseAdminClient()) {
    this.db = client;
  }

  async recordPracticeHeartbeat(params: {
    studentId: string;
    sessionId: string;
    assignmentId: string | null;
    nowIso: string;
    dailyCap: number;
    perBeatCap: number;
    maxAttempts: number;
  }): Promise<import("@/backend/session/session.dto").HeartbeatResponseDto> {
    const { data, error } = await this.db.rpc("record_practice_heartbeat", {
      p_student_id: params.studentId,
      p_session_id: params.sessionId,
      p_assignment_id: params.assignmentId,
      p_now: params.nowIso,
      p_daily_cap: params.dailyCap,
      p_per_beat_cap: params.perBeatCap,
      p_max_attempts: params.maxAttempts,
    });

    if (error) {
      if (error.message?.includes("RETAKE_LIMIT_EXCEEDED")) {
        throw new RetakeLimitExceededError(params.maxAttempts);
      }
      if (error.message?.includes("SESSION_FORBIDDEN")) {
        throw new SessionOwnershipError();
      }
      if (error.message?.includes("ASSIGNMENT_NOT_ASSIGNED")) {
        throw new ForbiddenError("This assignment is not assigned to you.");
      }
      if (error.message?.includes("SESSION_ENDED")) {
        throw new ForbiddenError("This speaking session has already ended.");
      }
      throw new SessionPersistenceError(`heartbeat record failed: ${error.message}`);
    }

    if (!data || typeof data !== "object") {
      throw new SessionPersistenceError("heartbeat RPC returned no result.");
    }
    return data as unknown as import("@/backend/session/session.dto").HeartbeatResponseDto;
  }

  // ── speaking_sessions ───────────────────────────────────────────────────────

  /**
   * Fetches a speaking session by its (client-generated) id.
   *
   * @param sessionId - The session UUID.
   * @returns The {@link SpeakingSessionEntity}, or `null` if not created yet.
   * @throws {SessionPersistenceError} On a read failure.
   */
  async findSessionById(sessionId: string): Promise<SpeakingSessionEntity | null> {
    const { data, error } = await this.db
      .from("speaking_sessions")
      .select("*")
      .eq("id", sessionId)
      .maybeSingle();

    if (error) {
      throw new SessionPersistenceError(`session read failed: ${error.message}`);
    }
    return data;
  }

  /**
   * Inserts a new speaking session.
   *
   * @param row - The session to create (client-generated `id` required).
   * @returns The persisted {@link SpeakingSessionEntity}.
   * @throws {SessionPersistenceError} On an insert failure.
   */
  async createSession(
    row: SpeakingSessionInsertEntity,
  ): Promise<SpeakingSessionEntity> {
    const { data, error } = await this.db
      .from("speaking_sessions")
      .insert(row)
      .select("*")
      .single();

    if (error || !data) {
      throw new SessionPersistenceError(
        error?.message ?? "session insert returned no row.",
      );
    }
    return data;
  }

  /**
   * Applies accumulation updates (seconds + heartbeat watermark) to a session.
   *
   * @param sessionId - The session to update.
   * @param patch     - The fields to write.
   * @throws {SessionPersistenceError} On an update failure.
   */
  async updateSession(
    sessionId: string,
    patch: SpeakingSessionUpdateEntity,
  ): Promise<void> {
    const { error } = await this.db
      .from("speaking_sessions")
      .update(patch)
      .eq("id", sessionId);

    if (error) {
      throw new SessionPersistenceError(`session update failed: ${error.message}`);
    }
  }

  /**
   * Counts a student's existing attempts against a formal assignment — the input
   * to the retake guardrail.
   *
   * @param studentId    - The student's id.
   * @param assignmentId - The assignment's id.
   * @returns The number of prior attempts (sessions with this assignment).
   * @throws {SessionPersistenceError} On a read failure.
   */
  async countAttempts(studentId: string, assignmentId: string): Promise<number> {
    const { count, error } = await this.db
      .from("speaking_sessions")
      .select("id", { count: "exact", head: true })
      .eq("student_id", studentId)
      .eq("assignment_id", assignmentId);

    if (error) {
      throw new SessionPersistenceError(`attempt count failed: ${error.message}`);
    }
    return count ?? 0;
  }

  /**
   * Returns, per assignment, how many attempts a student has made. Used to
   * enrich the dashboard's assignment cards.
   *
   * @param studentId - The student's id.
   * @returns A map of `assignment_id` → attempt count (free-practice excluded).
   * @throws {SessionPersistenceError} On a read failure.
   */
  async getAttemptCountsByAssignment(
    studentId: string,
  ): Promise<Map<string, number>> {
    const { data, error } = await this.db
      .from("speaking_sessions")
      .select("assignment_id")
      .eq("student_id", studentId)
      .not("assignment_id", "is", null);

    if (error) {
      throw new SessionPersistenceError(`attempt tally failed: ${error.message}`);
    }

    const counts = new Map<string, number>();
    for (const row of data ?? []) {
      if (row.assignment_id) {
        counts.set(row.assignment_id, (counts.get(row.assignment_id) ?? 0) + 1);
      }
    }
    return counts;
  }

  /**
   * Atomically records a one-shot coaching attempt via the
   * `record_coaching_attempt` Postgres function: it re-counts under a
   * per-(student, assignment) advisory lock, enforces the retake ceiling, inserts
   * the attempt, and marks the assignment completed — all in one transaction.
   * This closes the check-then-act race that the application-level path had.
   *
   * @param params.studentId    - The student's id.
   * @param params.assignmentId - The formal assignment's id.
   * @param params.maxAttempts  - The retake ceiling to enforce.
   * @param params.sessionId    - A freshly-generated UUID for the attempt row.
   * @param params.nowIso       - ISO-8601 timestamp for the attempt.
   * @returns The 1-based attempt number assigned.
   * @throws {RetakeLimitExceededError} When the ceiling is reached (raised inside
   *         the function, or as a unique-constraint backstop on a lost race).
   * @throws {SessionPersistenceError}  On any other database failure.
   */
  async recordCoachingAttempt(params: {
    studentId: string;
    assignmentId: string;
    maxAttempts: number;
    sessionId: string;
    nowIso: string;
  }): Promise<number> {
    const { data, error } = await this.db.rpc("record_coaching_attempt", {
      p_student_id: params.studentId,
      p_assignment_id: params.assignmentId,
      p_max_attempts: params.maxAttempts,
      p_session_id: params.sessionId,
      p_now: params.nowIso,
    });

    if (error) {
      // Both the explicit ceiling raise and the unique-constraint backstop
      // (23505, from a lost race) mean "no attempt slot available".
      if (error.message?.includes("RETAKE_LIMIT_EXCEEDED") || error.code === "23505") {
        throw new RetakeLimitExceededError(params.maxAttempts);
      }
      throw new SessionPersistenceError(`attempt record failed: ${error.message}`);
    }

    return data;
  }

  // ── practice_sessions (daily accumulator) ────────────────────────────────────

  /**
   * Reads a student's accumulator row for a specific day.
   *
   * @param studentId - The student's id.
   * @param date      - Calendar day (`YYYY-MM-DD`, UTC).
   * @returns The {@link PracticeDayEntity}, or `null` if none exists yet.
   * @throws {SessionPersistenceError} On a read failure.
   */
  async getDailyRow(
    studentId: string,
    date: string,
  ): Promise<PracticeDayEntity | null> {
    const { data, error } = await this.db
      .from("practice_sessions")
      .select("*")
      .eq("student_id", studentId)
      .eq("session_date", date)
      .maybeSingle();

    if (error) {
      throw new SessionPersistenceError(`daily read failed: ${error.message}`);
    }
    return data;
  }

  /**
   * Upserts a student's ABSOLUTE daily total for a day. The service computes the
   * governed total; this method persists it idempotently via the
   * (student_id, session_date) unique constraint.
   *
   * @param studentId       - The student's id.
   * @param date            - Calendar day (`YYYY-MM-DD`, UTC).
   * @param secondsPracticed - The new absolute total for the day.
   * @throws {SessionPersistenceError} On an upsert failure.
   */
  async upsertDailyTotal(
    studentId: string,
    date: string,
    secondsPracticed: number,
  ): Promise<void> {
    const { error } = await this.db.from("practice_sessions").upsert(
      {
        student_id: studentId,
        session_date: date,
        seconds_practiced: secondsPracticed,
      },
      { onConflict: "student_id,session_date" },
    );

    if (error) {
      throw new SessionPersistenceError(`daily upsert failed: ${error.message}`);
    }
  }

  /**
   * Reads a student's recent daily accumulator history, most recent first, for
   * the streak computation.
   *
   * @param studentId - The student's id.
   * @param limit     - Maximum number of days to return.
   * @returns Rows of `{ session_date, seconds_practiced }`.
   * @throws {SessionPersistenceError} On a read failure.
   */
  async getDailyHistory(
    studentId: string,
    limit?: number,
  ): Promise<Array<Pick<PracticeDayEntity, "session_date" | "seconds_practiced">>> {
    let query = this.db
      .from("practice_sessions")
      .select("session_date, seconds_practiced")
      .eq("student_id", studentId)
      .order("session_date", { ascending: false });

    if (limit !== undefined) {
      query = query.limit(limit);
    }

    const { data, error } = await query;

    if (error) {
      throw new SessionPersistenceError(`history read failed: ${error.message}`);
    }
    return data ?? [];
  }
}
