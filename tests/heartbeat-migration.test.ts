import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("Atomic heartbeat migration", () => {
  it("contains the concurrency, cap, ownership, and monotonic-time invariants", async () => {
    const sql = await readFile(
      new URL("../supabase/migrations/0007_atomic_heartbeat_engine.sql", import.meta.url),
      "utf8",
    );

    expect(sql).toContain("pg_advisory_xact_lock");
    expect(sql).toContain("SESSION_FORBIDDEN");
    expect(sql).toContain("ASSIGNMENT_NOT_ASSIGNED");
    expect(sql).toContain("SESSION_ENDED");
    expect(sql).toContain("v_remaining := greatest(0, p_daily_cap - v_daily_total)");
    expect(sql).toContain("v_credited := least(v_per_beat, v_remaining)");
    expect(sql).toContain("greatest(v_session.last_heartbeat_at, p_now)");
    expect(sql).toContain("on conflict (student_id, session_date)");
  });

  it("grants RPC execution only to service_role", async () => {
    const sql = await readFile(
      new URL("../supabase/migrations/0007_atomic_heartbeat_engine.sql", import.meta.url),
      "utf8",
    );

    expect(sql).toContain("grant execute");
    expect(sql).toContain("to service_role");
    expect(sql).toMatch(/revoke all[\s\S]*from anon, authenticated/);
  });
});
