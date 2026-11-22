import "server-only";

import { AssignmentRepository } from "@/backend/assignment/assignment.repository";
import { SessionRepository } from "@/backend/session/session.repository";
import { RetakeLimitExceededError } from "@/backend/student/student.errors";
import { ForbiddenError } from "@/backend/shared/app-error";
import {
  DAILY_CAP_SECONDS,
  DAILY_GOAL_SECONDS,
  MAX_ATTEMPTS_PER_ASSIGNMENT,
  MAX_CREDIT_PER_HEARTBEAT_SECONDS,
} from "@/backend/student/practice-policy";
import type {
  HeartbeatRequestDto,
  HeartbeatResponseDto,
} from "@/backend/session/session.dto";
import type { StreakSummaryDto } from "@/backend/session/streak.dto";
import type {
  StudentAssignmentsDto,
  StudentAssignmentViewDto,
} from "@/backend/assignment/assignment.dto";

/**
 * @file        src/backend/student/student.service.ts
 * @layer       Service Layer (Business Logic)
 * @description
 *  The student session engine. It owns the three governance rules of Phase 3:
 *
 *   1. **Fault-tolerant heartbeat accumulator** — each 30s ping credits time
 *      computed from the SERVER's `last_heartbeat_at` watermark (never a
 *      client-supplied duration), so dropped pings self-heal and the client
 *      cannot inflate its total.
 *   2. **Usage Governor** — the daily total is hard-capped at
 *      {@link DAILY_CAP_SECONDS}; heartbeats beyond it credit nothing.
 *   3. **Retake Guardrail** — a formal assignment admits at most
 *      {@link MAX_ATTEMPTS_PER_ASSIGNMENT} attempts.
 *
 *  It also computes the gamified consecutive-calendar-day streak from the daily
 *  accumulator history (the Accumulator Rule: the daily goal is cumulative).
 *
 * @remarks
 *  Transport-agnostic: consumes validated DTOs + a caller-supplied `now`
 *  (injected for testability), returns DTOs or throws typed {@link AppError}s.
 *  Heartbeats are recorded by an atomic Postgres RPC serialized per student,
 *  preventing concurrent requests from inflating practice totals or overlapping
 *  watermark updates.
 */
export class StudentService {
  private readonly sessions: SessionRepository;
  private readonly assignments: AssignmentRepository;

  /**
   * @param sessionRepository    - Repository for sessions + daily accumulator.
   * @param assignmentRepository - Repository for the student's assignments.
   */
  constructor(
    sessionRepository: SessionRepository = new SessionRepository(),
    assignmentRepository: AssignmentRepository = new AssignmentRepository(),
  ) {
    this.sessions = sessionRepository;
    this.assignments = assignmentRepository;
  }

  /**
   * Processes one heartbeat, crediting governed practice time to the session and
   * the day.
   *
   * Flow:
   *  - **First heartbeat** (session not yet persisted): enforce the retake
   *    guardrail (for formal attempts), create the session, and start the clock
   *    crediting nothing this beat.
   *  - **Subsequent heartbeats**: verify ownership, credit
   *    `min(elapsedSinceWatermark, perBeatCap, remainingDailyAllowance)`, then
   *    always advance the watermark to `now` so idle gaps never accrue.
   *
   * @param studentId - The verified caller's id (never trusted from the body).
   * @param dto       - The validated {@link HeartbeatRequestDto}.
   * @param now       - The server clock instant for this request.
   * @returns A {@link HeartbeatResponseDto} with live totals and stop signals.
   * @throws {RetakeLimitExceededError} When creating an attempt beyond the ceiling.
   * @throws {SessionOwnershipError}    When the session belongs to another user.
   * @throws {SessionPersistenceError}  On a database failure.
   */
  async recordHeartbeat(
    studentId: string,
    dto: HeartbeatRequestDto,
    now: Date,
  ): Promise<HeartbeatResponseDto> {
    return this.sessions.recordPracticeHeartbeat({
      studentId,
      sessionId: dto.sessionId,
      assignmentId: dto.assignmentId,
      nowIso: now.toISOString(),
      dailyCap: DAILY_CAP_SECONDS,
      perBeatCap: MAX_CREDIT_PER_HEARTBEAT_SECONDS,
      maxAttempts: MAX_ATTEMPTS_PER_ASSIGNMENT,
    });
  }

  /**
   * Builds the gamified streak summary from the daily accumulator history.
   *
   * The current streak is the run of consecutive days meeting the cumulative
   * goal, ending today — or, if today is not yet met, ending yesterday (the
   * streak stays "active" and "at risk" until midnight).
   *
   * @param studentId - The student's id.
   * @param now       - The server clock instant (defines "today", UTC).
   * @returns The {@link StreakSummaryDto}.
   * @throws {SessionPersistenceError} On a database failure.
   */
  async getStreakSummary(studentId: string, now: Date): Promise<StreakSummaryDto> {
    const history = await this.sessions.getDailyHistory(studentId);
    const today = StudentService.toUtcDateStr(now);

    const qualifying = new Set(
      history
        .filter((h) => h.seconds_practiced >= DAILY_GOAL_SECONDS)
        .map((h) => h.session_date),
    );

    // Current streak: anchor on today if met, else yesterday.
    const yesterday = StudentService.addDays(today, -1);
    let anchor: string | null = null;
    if (qualifying.has(today)) anchor = today;
    else if (qualifying.has(yesterday)) anchor = yesterday;

    let currentStreak = 0;
    if (anchor) {
      let cursor = anchor;
      while (qualifying.has(cursor)) {
        currentStreak += 1;
        cursor = StudentService.addDays(cursor, -1);
      }
    }

    // Longest streak: scan all qualifying days in ascending order.
    const ascending = [...qualifying].sort();
    let longestStreak = 0;
    let run = 0;
    let prev: string | null = null;
    for (const date of ascending) {
      run = prev !== null && StudentService.addDays(prev, 1) === date ? run + 1 : 1;
      if (run > longestStreak) longestStreak = run;
      prev = date;
    }

    const todaySeconds =
      history.find((h) => h.session_date === today)?.seconds_practiced ?? 0;
    const goalMetToday = todaySeconds >= DAILY_GOAL_SECONDS;

    return {
      currentStreak,
      longestStreak: Math.max(longestStreak, currentStreak),
      todaySeconds,
      dailyGoalSeconds: DAILY_GOAL_SECONDS,
      dailyCapSeconds: DAILY_CAP_SECONDS,
      goalMetToday,
      todayIsAtRisk: currentStreak > 0 && !goalMetToday,
      history: history.map((h) => ({
        date: h.session_date,
        seconds: h.seconds_practiced,
        goalMet: h.seconds_practiced >= DAILY_GOAL_SECONDS,
      })),
    };
  }

  /**
   * Asserts the student is permitted to make another attempt at a formal
   * assignment. A no-op for free practice (`null` assignment).
   *
   * Intended as a PRE-check callers run before starting an expensive or
   * one-shot attempt flow (e.g. before opening an AI coaching stream), so a
   * clean `409` can be returned instead of failing partway through.
   *
   * @param studentId    - The student's id.
   * @param assignmentId - The assignment id, or `null` for free practice.
   * @throws {RetakeLimitExceededError} When the attempt ceiling is reached.
   */
  async assertAttemptAllowed(
    studentId: string,
    assignmentId: string | null,
  ): Promise<void> {
    if (!assignmentId) return;
    await this.assertAssignmentAssigned(studentId, assignmentId);
    const used = await this.sessions.countAttempts(studentId, assignmentId);
    if (used >= MAX_ATTEMPTS_PER_ASSIGNMENT) {
      throw new RetakeLimitExceededError(MAX_ATTEMPTS_PER_ASSIGNMENT);
    }
  }

  /** Verifies that a formal assignment is actually distributed to the student. */
  async assertAssignmentAssigned(
    studentId: string,
    assignmentId: string,
  ): Promise<void> {
    const assigned = await this.assignments.isAssignedToStudent(
      studentId,
      assignmentId,
    );
    if (!assigned) {
      throw new ForbiddenError("This assignment is not assigned to you.");
    }
  }

  /**
   * Records a completed ONE-SHOT attempt against a formal assignment (e.g. an
   * AI coaching run, which is not a timed heartbeat session), enforces the retake
   * ceiling, and marks the student's distribution of that assignment completed —
   * all ATOMICALLY via the `record_coaching_attempt` Postgres function. This is
   * what makes a coaching run "count" toward the retake guardrail and surface as
   * completed on the instructor compliance tracker.
   *
   * @param studentId    - The student's id.
   * @param assignmentId - The formal assignment id (must be non-null).
   * @param now          - The server clock instant for the attempt timestamps.
   * @returns The 1-based attempt number assigned to this run.
   * @throws {RetakeLimitExceededError} If, under the atomic lock, the ceiling is
   *         already reached (e.g. a concurrent run won the last slot).
   * @throws {SessionPersistenceError}  On a database failure.
   * @remarks
   *  The count-and-insert is serialized inside the database per
   *  (student, assignment), so this is safe against the check-then-act race that
   *  a plain {@link assertAttemptAllowed} pre-check cannot fully close.
   */
  async finalizeCoachedAttempt(
    studentId: string,
    assignmentId: string,
    now: Date,
  ): Promise<number> {
    return this.sessions.recordCoachingAttempt({
      studentId,
      assignmentId,
      maxAttempts: MAX_ATTEMPTS_PER_ASSIGNMENT,
      sessionId: crypto.randomUUID(),
      nowIso: now.toISOString(),
    });
  }

  /**
   * Lists the student's assignments, each enriched with attempt usage against
   * the retake guardrail.
   *
   * @param studentId - The student's id.
   * @returns The {@link StudentAssignmentsDto}.
   * @throws {SessionPersistenceError | MetricsQueryError} On a database failure.
   */
  async getAssignments(studentId: string): Promise<StudentAssignmentsDto> {
    const [rows, attemptCounts] = await Promise.all([
      this.assignments.listAssignmentsForStudent(studentId),
      this.sessions.getAttemptCountsByAssignment(studentId),
    ]);

    const assignments: StudentAssignmentViewDto[] = rows.map(
      ({ assignment, status }) => {
        const attemptsUsed = attemptCounts.get(assignment.id) ?? 0;
        const attemptsRemaining = Math.max(
          0,
          MAX_ATTEMPTS_PER_ASSIGNMENT - attemptsUsed,
        );
        return {
          id: assignment.id,
          title: assignment.title,
          formatType: assignment.format_type,
          description: assignment.description,
          createdAt: assignment.created_at,
          status,
          attemptsUsed,
          attemptsRemaining,
          canAttempt: attemptsRemaining > 0,
        };
      },
    );

    return { assignments };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Internals
  // ───────────────────────────────────────────────────────────────────────────

  /** Formats a Date as a `YYYY-MM-DD` string in UTC (matches `session_date`). */
  private static toUtcDateStr(date: Date): string {
    return date.toISOString().slice(0, 10);
  }

  /**
   * Adds `delta` days to a `YYYY-MM-DD` date string, in UTC.
   *
   * @param dateStr - Base date (`YYYY-MM-DD`).
   * @param delta   - Signed number of days to add.
   * @returns The resulting `YYYY-MM-DD` string.
   */
  private static addDays(dateStr: string, delta: number): string {
    const ms = new Date(`${dateStr}T00:00:00Z`).getTime() + delta * 86_400_000;
    return new Date(ms).toISOString().slice(0, 10);
  }
}
