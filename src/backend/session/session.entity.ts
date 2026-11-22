import type {
  Database,
  SpeakingSessionStatusEnum,
} from "@/lib/supabase/database.types";

/**
 * @file        src/backend/session/session.entity.ts
 * @layer       Entity Layer (Persistence)
 * @description
 *  Exact row shapes for the session-engine tables: `speaking_sessions` (the
 *  per-session / per-attempt ledger carrying the server heartbeat watermark) and
 *  `practice_sessions` (the per-day accumulator that backs streaks and the daily
 *  governor).
 */

/** Re-export of the speaking-session lifecycle status. */
export type SpeakingSessionStatus = SpeakingSessionStatusEnum;

/** A `speaking_sessions` row exactly as stored in Supabase. */
export type SpeakingSessionEntity =
  Database["public"]["Tables"]["speaking_sessions"]["Row"];

/** The insert shape for a new speaking session (client-generated `id` required). */
export type SpeakingSessionInsertEntity =
  Database["public"]["Tables"]["speaking_sessions"]["Insert"];

/** The update shape for accumulating progress onto a speaking session. */
export type SpeakingSessionUpdateEntity =
  Database["public"]["Tables"]["speaking_sessions"]["Update"];

/** A `practice_sessions` (daily accumulator) row exactly as stored in Supabase. */
export type PracticeDayEntity =
  Database["public"]["Tables"]["practice_sessions"]["Row"];

/** The insert/upsert shape for the daily accumulator. */
export type PracticeDayInsertEntity =
  Database["public"]["Tables"]["practice_sessions"]["Insert"];
