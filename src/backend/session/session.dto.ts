import type { ValidationResult } from "@/backend/user/user.dto";

/**
 * @file        src/backend/session/session.dto.ts
 * @layer       DTO Layer (API boundary contracts)
 * @description
 *  Contracts and validators for the 30-second heartbeat. The inbound payload is
 *  deliberately MINIMAL — a client-generated session id and an optional
 *  assignment id. Crucially, it carries NO elapsed-time value: the server alone
 *  decides how much time to credit, computed from its own `last_heartbeat_at`
 *  watermark. This makes the accumulator tamper-resistant.
 *
 * @remarks
 *  Validators return a {@link ValidationResult} rather than throwing, so the
 *  controller maps failures to `400` deterministically.
 */

/** RFC-4122 UUID shape (any version), used to validate the client session id. */
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Raw heartbeat payload as it arrives on the wire, before validation. */
export interface HeartbeatRequestRaw {
  /** Client-generated UUID identifying the open speaking session. */
  sessionId?: unknown;
  /** Optional: the formal assignment this session is an attempt at. */
  assignmentId?: unknown;
}

/**
 * A validated heartbeat request.
 *
 * @property sessionId    - The open session's client-generated UUID.
 * @property assignmentId - The assignment under attempt, or `null` for free practice.
 */
export interface HeartbeatRequestDto {
  sessionId: string;
  assignmentId: string | null;
}

/**
 * The server's response to a heartbeat — everything the client needs to render
 * live progress and to decide whether to keep pinging.
 *
 * @property creditedSeconds    - Seconds this heartbeat actually added (governed).
 * @property sessionSeconds     - Total seconds accumulated by THIS session.
 * @property dailyTotalSeconds  - Student's governed total for the current day.
 * @property dailyGoalSeconds   - The streak goal (10 min).
 * @property dailyCapSeconds    - The daily governor ceiling (30 min).
 * @property goalMet            - Whether today's streak goal is reached.
 * @property dailyCapReached    - Whether the daily ceiling is hit (stop pinging).
 * @property attemptNumber      - 1-based attempt index for a formal attempt, else null.
 * @property isNewSession       - Whether this heartbeat created the session.
 * @property intervalSeconds    - Recommended client ping cadence.
 */
export interface HeartbeatResponseDto {
  creditedSeconds: number;
  sessionSeconds: number;
  dailyTotalSeconds: number;
  dailyGoalSeconds: number;
  dailyCapSeconds: number;
  goalMet: boolean;
  dailyCapReached: boolean;
  attemptNumber: number | null;
  isNewSession: boolean;
  intervalSeconds: number;
}

/**
 * Validates and normalises a raw heartbeat payload.
 *
 * @param input - The untrusted, parsed JSON body (shape unknown).
 * @returns A {@link ValidationResult}: the {@link HeartbeatRequestDto} on
 *          success, or the list of field errors on failure.
 */
export function validateHeartbeatRequest(
  input: HeartbeatRequestRaw | unknown,
): ValidationResult<HeartbeatRequestDto> {
  const errors: string[] = [];
  const body = (input ?? {}) as HeartbeatRequestRaw;

  const sessionId = typeof body.sessionId === "string" ? body.sessionId.trim() : "";
  if (sessionId.length === 0) {
    errors.push("sessionId is required.");
  } else if (!UUID_PATTERN.test(sessionId)) {
    errors.push("sessionId must be a valid UUID.");
  }

  let assignmentId: string | null = null;
  if (body.assignmentId !== undefined && body.assignmentId !== null) {
    if (typeof body.assignmentId !== "string" || !UUID_PATTERN.test(body.assignmentId.trim())) {
      errors.push("assignmentId, when provided, must be a valid UUID.");
    } else {
      assignmentId = body.assignmentId.trim();
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return { ok: true, value: { sessionId, assignmentId } };
}
