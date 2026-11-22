/**
 * @file        src/backend/session/streak.dto.ts
 * @layer       DTO Layer (API boundary contracts)
 * @description
 *  Outbound contracts for the gamification / streak surface. A streak is a run
 *  of consecutive calendar days on each of which the student met the cumulative
 *  daily goal ({@link DAILY_GOAL_SECONDS}). These DTOs are pure projections
 *  computed by the service from the daily-accumulator history.
 */

/** A single day's practice entry in the streak history. */
export interface DailyPracticeDto {
  /** Calendar day in `YYYY-MM-DD` (UTC). */
  date: string;
  /** Governed seconds practiced that day. */
  seconds: number;
  /** Whether the day met the cumulative goal. */
  goalMet: boolean;
}

/**
 * The gamified streak summary rendered on the student dashboard.
 *
 * @property currentStreak     - Consecutive qualifying days ending today (or, if
 *                               today is not yet met, ending yesterday — the
 *                               streak remains "active" until midnight).
 * @property longestStreak     - The longest qualifying run on record.
 * @property todaySeconds      - Governed seconds accumulated so far today.
 * @property dailyGoalSeconds  - The goal threshold (10 min).
 * @property dailyCapSeconds   - The daily governor ceiling (30 min).
 * @property goalMetToday      - Whether today already qualifies.
 * @property todayIsAtRisk     - `true` when a nonzero streak has NOT been secured
 *                               today (i.e. today's goal is not yet met).
 * @property history           - Recent daily entries (most recent first).
 */
export interface StreakSummaryDto {
  currentStreak: number;
  longestStreak: number;
  todaySeconds: number;
  dailyGoalSeconds: number;
  dailyCapSeconds: number;
  goalMetToday: boolean;
  todayIsAtRisk: boolean;
  history: readonly DailyPracticeDto[];
}
