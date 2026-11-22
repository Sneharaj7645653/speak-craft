import { mkdirSync, writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";

const pool = new Pool({
  host: process.env.PGHOST ?? "127.0.0.1",
  port: Number(process.env.PGPORT ?? 54322),
  database: process.env.PGDATABASE ?? "postgres",
  user: process.env.PGUSER ?? "postgres",
  password: process.env.PGPASSWORD ?? "postgres",
  max: 50,
  idleTimeoutMillis: 5_000,
});

const CONCURRENCY = [1, 10, 25, 50, 100];
const REPS = 3;
const BASE_NOW = new Date("2026-02-01T12:00:00.000Z");
const DAY_CAP = 1800;
const PER_BEAT_CAP = 60;

interface LatencyResult {
  reps: number[];
  medianAverageMs: number;
  medianP50Ms: number;
  medianP95Ms: number;
  medianP99Ms: number;
  medianThroughput: number;
  medianFailed: number;
  medianSuccess: number;
  medianDatabaseMs?: number;
}

interface RepResult {
  requestCount: number;
  success: number;
  failed: number;
  averageMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  throughput: number;
  databaseMs?: number;
}

function studentId(i: number): string {
  return `10000000-0000-4000-8000-${i.toString().padStart(12, "0")}`;
}

function sessionId(i: number): string {
  return `30000000-0000-4000-8000-${i.toString().padStart(12, "0")}`;
}

function assignmentId(i: number): string {
  return `20000000-0000-4000-8000-${i.toString().padStart(12, "0")}`;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.max(0, Math.ceil(p * sorted.length) - 1);
  return sorted[index]!;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 0) return 0;
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle]!;
  return (sorted[middle - 1]! + sorted[middle]!) / 2;
}

async function resetHeartbeatUsers(count: number): Promise<void> {
  const ids = Array.from({ length: count }, (_, i) => studentId(i + 1));
  await pool.query(
    `delete from public.speaking_sessions where student_id = any($1::uuid[])`,
    [ids],
  );
  await pool.query(
    `delete from public.practice_sessions where student_id = any($1::uuid[])`,
    [ids],
  );
}

async function setupExistingSessions(count: number, now: Date): Promise<void> {
  await resetHeartbeatUsers(count);
  for (let i = 1; i <= count; i += 1) {
    await pool.query(
      `insert into public.speaking_sessions
       (id, student_id, assignment_id, attempt_number, seconds_accumulated, status, started_at, last_heartbeat_at)
       values ($1, $2, null, null, 0, 'active', $3, $4)`,
      [sessionId(i), studentId(i), new Date(now.getTime() - 60_000).toISOString(), new Date(now.getTime() - 60_000).toISOString()],
    );
  }
}

function summarize(
  reps: RepResult[],
): LatencyResult {
  return {
    reps: reps.map((r) => r.requestCount),
    medianAverageMs: median(reps.map((r) => r.averageMs)),
    medianP50Ms: median(reps.map((r) => r.p50Ms)),
    medianP95Ms: median(reps.map((r) => r.p95Ms)),
    medianP99Ms: median(reps.map((r) => r.p99Ms)),
    medianThroughput: median(reps.map((r) => r.throughput)),
    medianFailed: median(reps.map((r) => r.failed)),
    medianSuccess: median(reps.map((r) => r.success)),
  };
}

async function runConcurrent<T>(
  count: number,
  operation: (i: number) => Promise<T>,
): Promise<RepResult> {
  const times: number[] = [];
  let success = 0;
  let failed = 0;
  const started = performance.now();
  await Promise.all(
    Array.from({ length: count }, async (_, i) => {
      const t = performance.now();
      try {
        await operation(i + 1);
        success += 1;
      } catch {
        failed += 1;
      } finally {
        times.push(performance.now() - t);
      }
    }),
  );
  const elapsed = (performance.now() - started) / 1000;
  const sorted = [...times].sort((a, b) => a - b);
  const average = times.reduce((sum, value) => sum + value, 0) / times.length;
  return {
    requestCount: count,
    success,
    failed,
    averageMs: average,
    p50Ms: percentile(sorted, 0.50),
    p95Ms: percentile(sorted, 0.95),
    p99Ms: percentile(sorted, 0.99),
    throughput: count / elapsed,
  };
}

async function callNewHeartbeat(
  i: number,
  now: Date,
): Promise<void> {
  await pool.query(
    `select public.record_practice_heartbeat($1::uuid, $2::uuid, null, $3::timestamptz, $4::integer, $5::integer, $6::integer)`,
    [studentId(i), sessionId(i), now.toISOString(), DAY_CAP, PER_BEAT_CAP, 4],
  );
}

async function callOldHeartbeat(
  i: number,
  now: Date,
): Promise<void> {
  const client = await pool.connect();
  try {
    const sessionResult = await client.query(
      `select * from public.speaking_sessions where id = $1`,
      [sessionId(i)],
    );
    const session = sessionResult.rows[0];
    if (!session) {
      await client.query(
        `insert into public.speaking_sessions
         (id, student_id, assignment_id, attempt_number, seconds_accumulated, status, started_at, last_heartbeat_at)
         values ($1, $2, null, null, 0, 'active', $3, $3)`,
        [sessionId(i), studentId(i), now.toISOString()],
      );
      return;
    }
    if (session.student_id !== studentId(i)) {
      throw new Error("SESSION_FORBIDDEN");
    }
    const elapsedSeconds = Math.max(
      0,
      Math.floor(
        (now.getTime() - new Date(session.last_heartbeat_at).getTime()) / 1000,
      ),
    );
    const perBeat = Math.min(elapsedSeconds, PER_BEAT_CAP);
    const day = now.toISOString().slice(0, 10);
    const dailyResult = await client.query(
      `select seconds_practiced from public.practice_sessions
       where student_id = $1 and session_date = $2`,
      [studentId(i), day],
    );
    const daily = dailyResult.rows[0]?.seconds_practiced ?? 0;
    const credited = Math.min(perBeat, Math.max(0, DAY_CAP - daily));
    await client.query(
      `update public.speaking_sessions
       set seconds_accumulated = $1, last_heartbeat_at = $2
       where id = $3`,
      [session.seconds_accumulated + credited, now.toISOString(), sessionId(i)],
    );
    const newDaily = daily + credited;
    if (credited > 0) {
      await client.query(
        `insert into public.practice_sessions (student_id, session_date, seconds_practiced)
         values ($1, $2, $3)
         on conflict (student_id, session_date)
         do update set seconds_practiced = excluded.seconds_practiced`,
        [studentId(i), day, newDaily],
      );
    }
  } finally {
    client.release();
  }
}

async function correctnessTests(): Promise<Array<Record<string, unknown>>> {
  const results: Array<Record<string, unknown>> = [];
  const add = (
    name: string,
    expected: string,
    actual: string,
    passed: boolean,
  ) => results.push({ name, expected, actual, passed });

  const i = 1;
  await resetHeartbeatUsers(100);
  const sid = sessionId(i);
  const uid = studentId(i);

  const first = await pool.query(
    `select public.record_practice_heartbeat($1::uuid, $2::uuid, null, $3::timestamptz, 1800, 60, 4) as result`,
    [uid, sid, BASE_NOW.toISOString()],
  );
  const firstResult = first.rows[0].result as Record<string, unknown>;
  add(
    "first heartbeat creates session",
    "isNewSession=true, creditedSeconds=0",
    `isNewSession=${firstResult.isNewSession}, creditedSeconds=${firstResult.creditedSeconds}`,
    firstResult.isNewSession === true && firstResult.creditedSeconds === 0,
  );

  const second = await pool.query(
    `select public.record_practice_heartbeat($1::uuid, $2::uuid, null, $3::timestamptz, 1800, 60, 4) as result`,
    [uid, sid, new Date(BASE_NOW.getTime() + 30_000).toISOString()],
  );
  const secondResult = second.rows[0].result as Record<string, unknown>;
  add(
    "30-second heartbeat credit",
    "creditedSeconds=30",
    `creditedSeconds=${secondResult.creditedSeconds}`,
    secondResult.creditedSeconds === 30,
  );

  const duplicate = await pool.query(
    `select public.record_practice_heartbeat($1::uuid, $2::uuid, null, $3::timestamptz, 1800, 60, 4) as result`,
    [uid, sid, new Date(BASE_NOW.getTime() + 30_000).toISOString()],
  );
  const duplicateResult = duplicate.rows[0].result as Record<string, unknown>;
  add(
    "duplicate timestamp does not double credit",
    "creditedSeconds=0",
    `creditedSeconds=${duplicateResult.creditedSeconds}`,
    duplicateResult.creditedSeconds === 0,
  );

  await resetHeartbeatUsers(100);
  await setupExistingSessions(1, BASE_NOW);
  let maxSessionSeconds = 0;
  let maxDailySeconds = 0;
  for (let beat = 1; beat <= 100; beat += 1) {
    const result = await pool.query(
      `select public.record_practice_heartbeat($1::uuid, $2::uuid, null, $3::timestamptz, 1800, 60, 4) as result`,
      [uid, sid, new Date(BASE_NOW.getTime() + beat * 30_000).toISOString()],
    );
    const row = result.rows[0].result as Record<string, unknown>;
    maxSessionSeconds = Math.max(maxSessionSeconds, Number(row.sessionSeconds));
    maxDailySeconds = Math.max(maxDailySeconds, Number(row.dailyTotalSeconds));
  }
  add(
    "100 beats respect daily and per-beat caps",
    "sessionSeconds<=1800, dailyTotalSeconds<=1800",
    `sessionSeconds=${maxSessionSeconds}, dailyTotalSeconds=${maxDailySeconds}`,
    maxSessionSeconds <= 1800 && maxDailySeconds <= 1800,
  );

  await resetHeartbeatUsers(100);
  await setupExistingSessions(1, BASE_NOW);
  const backward = await pool.query(
    `select public.record_practice_heartbeat($1::uuid, $2::uuid, null, $3::timestamptz, 1800, 60, 4) as result`,
    [uid, sid, new Date(BASE_NOW.getTime() - 60_000).toISOString()],
  );
  const backwardResult = backward.rows[0].result as Record<string, unknown>;
  add(
    "backward clock cannot credit or move watermark",
    "creditedSeconds=0",
    `creditedSeconds=${backwardResult.creditedSeconds}`,
    backwardResult.creditedSeconds === 0,
  );

  await pool.query(
    `update public.speaking_sessions set status='ended' where id=$1`,
    [sid],
  );
  let endedPassed = false;
  let endedActual = "unexpected success";
  try {
    await pool.query(
      `select public.record_practice_heartbeat($1::uuid, $2::uuid, null, $3::timestamptz, 1800, 60, 4)`,
      [uid, sid, new Date(BASE_NOW.getTime() + 60_000).toISOString()],
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    endedPassed = message.includes("SESSION_ENDED");
    endedActual = endedPassed ? "SESSION_ENDED" : message;
  }
  add(
    "ended session cannot continue",
    "SESSION_ENDED",
    endedActual,
    endedPassed,
  );

  await resetHeartbeatUsers(100);
  let ownershipPassed = false;
  let ownershipActual = "unexpected success";
  try {
    await pool.query(
      `select public.record_practice_heartbeat($1::uuid, $2::uuid, $3::uuid, $4::timestamptz, 1800, 60, 4)`,
      [uid, sid, "90000000-0000-4000-8000-000000000000", BASE_NOW.toISOString()],
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    ownershipPassed =
      message.includes("ASSIGNMENT_NOT_ASSIGNED") ||
      message.includes("SESSION_FORBIDDEN");
    ownershipActual = ownershipPassed
      ? (message.includes("ASSIGNMENT_NOT_ASSIGNED")
          ? "ASSIGNMENT_NOT_ASSIGNED"
          : "SESSION_FORBIDDEN")
      : message;
  }
  add(
    "unowned assignment is rejected",
    "ASSIGNMENT_NOT_ASSIGNED or SESSION_FORBIDDEN",
    ownershipActual,
    ownershipPassed,
  );

  await resetHeartbeatUsers(100);
  await setupExistingSessions(1, BASE_NOW);
  const simultaneous = await Promise.allSettled(
    Array.from({ length: 100 }, () =>
      pool.query(
        `select public.record_practice_heartbeat($1::uuid, $2::uuid, null, $3::timestamptz, 1800, 60, 4) as result`,
        [uid, sid, new Date(BASE_NOW.getTime() + 60_000).toISOString()],
      ),
    ),
  );
  const simultaneousSuccess = simultaneous.filter((r) => r.status === "fulfilled").length;
  const finalSession = await pool.query(
    `select seconds_accumulated from public.speaking_sessions where id=$1`,
    [sid],
  );
  const finalDaily = await pool.query(
    `select seconds_practiced from public.practice_sessions where student_id=$1 and session_date=$2`,
    [uid, "2026-02-01"],
  );
  const finalSessionSeconds = Number(finalSession.rows[0]?.seconds_accumulated ?? 0);
  const finalDailySeconds = Number(finalDaily.rows[0]?.seconds_practiced ?? 0);
  add(
    "100 simultaneous requests for one student",
    "success=100, sessionSeconds<=60, dailySeconds<=60",
    `success=${simultaneousSuccess}, sessionSeconds=${finalSessionSeconds}, dailySeconds=${finalDailySeconds}`,
    simultaneousSuccess === 100 &&
      finalSessionSeconds <= 60 &&
      finalDailySeconds <= 60,
  );

  return results;
}

async function streakCheck(): Promise<Record<string, unknown>> {
  const result = await pool.query(
    `select to_char(session_date, 'YYYY-MM-DD') as session_date, seconds_practiced
     from public.practice_sessions
     where student_id=$1
     order by session_date desc`,
    [studentId(300)],
  );
  const rows = result.rows as Array<{ session_date: string | Date; seconds_practiced: number }>;
  const qualifying = new Set(
    rows
      .filter((row) => Number(row.seconds_practiced) >= 600)
      .map((row) =>
        {
          if (row.session_date instanceof Date) {
            return [
              row.session_date.getUTCFullYear(),
              String(row.session_date.getUTCMonth() + 1).padStart(2, "0"),
              String(row.session_date.getUTCDate()).padStart(2, "0"),
            ].join("-");
          }
          const raw = String(row.session_date);
          return /^\d{4}-\d{2}-\d{2}/.test(raw)
            ? raw.slice(0, 10)
            : "1970-01-01";
        },
      ),
  );
  let current = 0;
  let cursor = new Date();
  cursor = new Date(
    Date.UTC(
      cursor.getUTCFullYear(),
      cursor.getUTCMonth(),
      cursor.getUTCDate(),
    ),
  );
  while (qualifying.has(cursor.toISOString().slice(0, 10))) {
    current += 1;
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return {
    rowCount: rows.length,
    qualifyingCount: qualifying.size,
    streakAtBenchmarkDate: current,
  };
}

async function explainQuery(
  label: string,
  sql: string,
  params: unknown[] = [],
): Promise<number> {
  const result = await pool.query(
    `explain (analyze, buffers, format json) ${sql}`,
    params,
  );
  const plan = result.rows[0]["QUERY PLAN"][0];
  const execution = Number(plan["Execution Time"]);
  return execution;
}

async function benchmarkOperations(): Promise<Record<string, unknown>> {
  const heartbeatOld: Record<string, unknown> = {};
  const heartbeatNew: Record<string, unknown> = {};
  const now = BASE_NOW;

  for (const count of CONCURRENCY) {
    const oldReps: RepResult[] = [];
    const newReps: RepResult[] = [];
    for (let rep = 0; rep < REPS; rep += 1) {
      await setupExistingSessions(count, now);
      oldReps.push(
        await runConcurrent(count, (i) =>
          callOldHeartbeat(i, new Date(now.getTime() + 60_000)),
        ),
      );
      await setupExistingSessions(count, now);
      newReps.push(
        await runConcurrent(count, (i) =>
          callNewHeartbeat(i, new Date(now.getTime() + 60_000)),
        ),
      );
    }
    heartbeatOld[String(count)] = summarize(oldReps);
    heartbeatNew[String(count)] = summarize(newReps);
  }

  const streak: Record<string, unknown> = {};
  for (const count of CONCURRENCY) {
    const reps: RepResult[] = [];
    for (let rep = 0; rep < REPS; rep += 1) {
      reps.push(
        await runConcurrent(count, async () => {
          await pool.query(
            `select session_date, seconds_practiced
             from public.practice_sessions
             where student_id=$1
             order by session_date desc`,
            [studentId(300)],
          );
        }),
      );
    }
    streak[String(count)] = summarize(reps);
  }

  const metrics: Record<string, unknown> = {};
  for (const count of CONCURRENCY) {
    const reps: RepResult[] = [];
    for (let rep = 0; rep < REPS; rep += 1) {
      reps.push(
        await runConcurrent(count, async () => {
          await pool.query(
            `select * from public.student_compliance_metrics order by name`,
          );
        }),
      );
    }
    metrics[String(count)] = summarize(reps);
  }

  const assignmentDistribution: Record<string, unknown> = {};
  for (const count of CONCURRENCY) {
    const reps: RepResult[] = [];
    for (let rep = 0; rep < REPS; rep += 1) {
      reps.push(
        await runConcurrent(count, async () => {
          const client = await pool.connect();
          try {
            await client.query("begin");
            const assignment = randomUUID();
            await client.query(
              `insert into public.assignments (id, title, format_type, description)
               values ($1, 'Benchmark Assignment', 'extempore', 'Synthetic benchmark')`,
              [assignment],
            );
            await client.query(
              `insert into public.student_assignments (assignment_id, student_id, status)
               select $1, id, 'assigned'
               from public.users
               where email like 'bench%@local.test'`,
              [assignment],
            );
            await client.query("rollback");
          } finally {
            client.release();
          }
        }),
      );
    }
    assignmentDistribution[String(count)] = summarize(reps);
  }

  await resetHeartbeatUsers(100);
  await setupExistingSessions(1, now);
  const heartbeatExplainMs = await explainQuery(
    "heartbeat",
    `select public.record_practice_heartbeat($1::uuid, $2::uuid, null, $3::timestamptz, 1800, 60, 4)`,
    [studentId(1), sessionId(1), new Date(now.getTime() + 60_000).toISOString()],
  );
  const streakExplainMs = await explainQuery(
    "streak",
    `select session_date, seconds_practiced from public.practice_sessions where student_id=$1 order by session_date desc`,
    [studentId(300)],
  );
  const metricsExplainMs = await explainQuery(
    "metrics",
    `select * from public.student_compliance_metrics order by name`,
  );

  return {
    heartbeatOld,
    heartbeatNew,
    streak,
    metrics,
    assignmentDistribution,
    explainAnalyze: {
      heartbeatMs: heartbeatExplainMs,
      streakMs: streakExplainMs,
      metricsMs: metricsExplainMs,
    },
  };
}

async function main(): Promise<void> {
  const ping = await pool.query("select 1 as ok");
  if (ping.rows[0]?.ok !== 1) {
    throw new Error("Local PostgreSQL connection check failed.");
  }

  const versionResult = await pool.query("select version()");
  const postgresVersion = String(versionResult.rows[0]?.version ?? "UNKNOWN");

  const correctness = await correctnessTests();
  const streak = await streakCheck();
  const benchmark = await benchmarkOperations();

  const output = {
    generatedAt: new Date().toISOString(),
    environment: {
      platform: process.platform,
      architecture: process.arch,
      node: process.version,
      postgres: postgresVersion,
      cpuCount: (await import("node:os")).cpus().length,
      totalMemoryBytes: (await import("node:os")).totalmem(),
      concurrencyLevels: CONCURRENCY,
      repetitionsPerLevel: REPS,
      dataset: {
        syntheticStudents: 300,
        syntheticAssignments: 10,
        syntheticDistributions: 3000,
        streakHistoryRows: 400,
      },
    },
    correctness,
    streak,
    benchmark,
    ai: {
      groqConfigured: Boolean(process.env.GROQ_API_KEY?.trim()),
      geminiConfigured: Boolean(process.env.GEMINI_API_KEY?.trim()),
      status:
        Boolean(process.env.GROQ_API_KEY?.trim()) ||
        Boolean(process.env.GEMINI_API_KEY?.trim())
          ? "provider_configuration_detected_not_exercised"
          : "unavailable_no_local_provider_key",
    },
  };

  mkdirSync("benchmarks", { recursive: true });
  writeFileSync(
    "benchmarks/local-db-results.json",
    `${JSON.stringify(output, null, 2)}\n`,
  );
  console.log(
    JSON.stringify(
      {
        output: "benchmarks/local-db-results.json",
        correctnessFailed: correctness.filter((r) => r.passed !== true).length,
        aiStatus: output.ai.status,
        postgresConnected: true,
      },
      null,
      2,
    ),
  );
  await pool.end();
}

main().catch(async (error) => {
  console.error(error instanceof Error ? error.message : String(error));
  await pool.end();
  process.exitCode = 1;
});
