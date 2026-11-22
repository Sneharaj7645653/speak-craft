import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/lib/supabase/database.types";
import { EvaluationPersistenceError } from "@/backend/ai/ai.errors";
import type {
  EvaluationEntity,
  EvaluationInsertEntity,
} from "@/backend/ai/evaluation.entity";

/**
 * @file        src/backend/ai/evaluation.repository.ts
 * @layer       Repository Layer (Data Access)
 * @description
 *  Persists the final, consolidated coaching result — text transcript, delivery
 *  metrics, numeric score, serving provider, and the structured textual analysis
 *  — to Supabase once the evaluation stream terminates.
 *
 * @remarks
 *  Uses the service-role admin client (`fetch`-based, Edge-runtime compatible).
 *  The coaching endpoint runs on the Edge; this repository performs a single
 *  PostgREST insert with no Node-only dependencies. Server-only.
 */
export class EvaluationRepository {
  private readonly db: SupabaseClient<Database>;

  /**
   * @param client - Optional Supabase client (for testing). Defaults to the
   *                 process-level service-role admin client.
   */
  constructor(client: SupabaseClient<Database> = getSupabaseAdminClient()) {
    this.db = client;
  }

  /**
   * Inserts a completed evaluation record.
   *
   * @param row - The fully-formed {@link EvaluationInsertEntity} to persist.
   * @returns The persisted {@link EvaluationEntity}.
   * @throws {EvaluationPersistenceError} When the insert fails.
   */
  async saveEvaluation(
    row: EvaluationInsertEntity,
  ): Promise<EvaluationEntity> {
    const { data, error } = await this.db
      .from("evaluations")
      .insert(row)
      .select("*")
      .single();

    if (error || !data) {
      throw new EvaluationPersistenceError(
        error?.message ?? "insert returned no row.",
      );
    }
    return data;
  }
}
