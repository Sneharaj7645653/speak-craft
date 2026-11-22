import type { AiProviderEnum, Database } from "@/lib/supabase/database.types";

/**
 * @file        src/backend/ai/evaluation.entity.ts
 * @layer       Entity Layer (Persistence)
 * @description
 *  Exact row shape of the `evaluations` table — the durable record of one AI
 *  coaching run. It maps the structured grading fields (numeric `score`, the
 *  serving `provider`, delivery `metrics`), the text `transcript`, the
 *  consolidated textual `feedback`, and the `created_at` timestamp for logging.
 *
 * @remarks
 *  Per the audio storage-safety rule, this entity is text-and-numbers only — no
 *  audio binary is ever represented here.
 */

/** The LLM provider that produced an evaluation ('groq' primary / 'gemini' fallback). */
export type AiProvider = AiProviderEnum;

/** An `evaluations` row exactly as stored in and returned from Supabase. */
export type EvaluationEntity = Database["public"]["Tables"]["evaluations"]["Row"];

/** The insert shape accepted by the `evaluations` table (defaults optional). */
export type EvaluationInsertEntity =
  Database["public"]["Tables"]["evaluations"]["Insert"];
