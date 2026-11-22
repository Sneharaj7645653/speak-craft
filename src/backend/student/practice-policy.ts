/**
 * @file        src/backend/student/practice-policy.ts
 * @layer       Domain policy (pure constants — safe on client and server)
 * @description
 *  The single source of truth for the practice-governance rules of Phase 3.
 *  Centralising them here means the service (enforcement), the controller
 *  (contracts), and the UI (display / interval timing) all agree by construction.
 *
 * @remarks
 *  This module has NO side effects and imports nothing server-only, so client
 *  components may import the constants for display and heartbeat timing.
 */

/** Heartbeat cadence: the client pings this often while a session is open. */
export const HEARTBEAT_INTERVAL_SECONDS = 30;

/**
 * The Accumulator Rule: a day counts toward the streak once the student has
 * accumulated this many seconds — cumulatively, across any number of sessions.
 * (10 minutes.)
 */
export const DAILY_GOAL_SECONDS = 10 * 60;

/**
 * Usage Governor: the hard ceiling on credited practice per student per day.
 * Heartbeats beyond this add nothing, keeping cloud costs bounded. (30 minutes.)
 */
export const DAILY_CAP_SECONDS = 30 * 60;

/**
 * The maximum seconds a SINGLE heartbeat may credit. Set to two nominal
 * intervals so one dropped ping is still fully credited on recovery, while a
 * long gap (backgrounded / throttled tab, sleep) cannot credit runaway time.
 */
export const MAX_CREDIT_PER_HEARTBEAT_SECONDS = HEARTBEAT_INTERVAL_SECONDS * 2;

/**
 * Retake Guardrail: the maximum number of attempts a student may make against a
 * single formal speech assignment. The directive specifies a 3–4 range; 4 is the
 * enforced ceiling. Adjust here to move within that range.
 */
export const MAX_ATTEMPTS_PER_ASSIGNMENT = 4;
