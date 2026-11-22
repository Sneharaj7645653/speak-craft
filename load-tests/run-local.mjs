import { randomBytes } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const loadTestDir = path.join(root, "load-tests");
const resultsRoot = path.join(loadTestDir, "results");
const appUrl = "http://127.0.0.1:3100";
const concurrencyLevels = [1, 10, 25, 50, 100];
const operations = ["heartbeat", "streak", "metrics", "assignment"];

function fail(message) {
  throw new Error(message);
}

function parseEnvOutput(output) {
  const parsed = {};
  for (const line of output.split(/\r?\n/)) {
    const match = line.match(/^([A-Z_]+)=(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if (value.startsWith('"') && value.endsWith('"')) {
      value = JSON.parse(value);
    } else if (value.startsWith("'") && value.endsWith("'")) {
      value = value.slice(1, -1);
    }
    parsed[match[1]] = value;
  }
  return parsed;
}

function assertLoopbackUrl(value, label) {
  let url;
  try {
    url = new URL(value);
  } catch {
    fail(`${label} is not a valid URL.`);
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    !["127.0.0.1", "localhost", "::1"].includes(url.hostname)
  ) {
    fail(`${label} must resolve to loopback; refusing to send test traffic.`);
  }
  return url;
}

function getLocalSupabaseConfig() {
  let output;
  try {
    output = execFileSync("supabase", ["status", "-o", "env"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch {
    fail("Could not read local Supabase status. Start the local stack first.");
  }
  const config = parseEnvOutput(output);
  assertLoopbackUrl(config.API_URL || "", "Supabase API URL");
  assertLoopbackUrl(appUrl, "Application URL");
  for (const key of ["API_URL", "ANON_KEY", "SERVICE_ROLE_KEY", "DB_URL"]) {
    if (!config[key]) fail(`Local Supabase status is missing ${key}.`);
  }
  return config;
}

function makePool(config) {
  return new Pool({
    connectionString: config.DB_URL,
    max: 10,
    idleTimeoutMillis: 5_000,
    connectionTimeoutMillis: 5_000,
  });
}

function studentId(index) {
  return `10000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

function sessionId(runId, scenarioId, vuId) {
  const suffix =
    runId +
    String(scenarioId).padStart(4, "0") +
    String(vuId).padStart(4, "0");
  return `40000000-0000-4000-8000-${suffix}`;
}

function sessionPrefix(runId) {
  return `40000000-0000-4000-8000-${runId}%`;
}

async function assertBaseline(pool) {
  const { rows } = await pool.query(`
    select
      (select count(*) from public.users where email like 'bench%@local.test') as students,
      (select count(*) from public.assignments where id::text like '20000000-%') as assignments,
      (select count(*) from public.student_assignments sa
        join public.users u on u.id = sa.student_id
        where u.email like 'bench%@local.test') as distributions,
      (select count(*) from public.practice_sessions p
        join public.users u on u.id = p.student_id
        where u.email = 'bench0300@local.test') as streak_days
  `);
  const baseline = Object.fromEntries(
    Object.entries(rows[0]).map(([key, value]) => [key, Number(value)]),
  );
  if (
    baseline.students !== 300 ||
    baseline.assignments !== 10 ||
    baseline.distributions !== 3000 ||
    baseline.streak_days !== 400
  ) {
    fail(`Synthetic benchmark baseline differs from expected: ${JSON.stringify(baseline)}`);
  }
  return baseline;
}

async function installSyntheticInstructor(pool) {
  const sql = await readFile(path.join(loadTestDir, "setup.sql"), "utf8");
  await pool.query(sql);
  const result = await pool.query(
    `select count(*)::int as count from public.users
     where id = '40000000-0000-4000-8000-000000000001'
       and role = 'instructor'
       and email = 'loadtest-instructor@local.test'`,
  );
  if (result.rows[0]?.count !== 1) {
    fail("Synthetic local instructor setup did not complete.");
  }
}

async function assertNoCurrentDayPractice(pool, count) {
  const ids = Array.from({ length: count }, (_, index) => studentId(index + 1));
  const { rows } = await pool.query(
    `select count(*)::int as count from public.practice_sessions
     where student_id = any($1::uuid[]) and session_date = current_date`,
    [ids],
  );
  if (rows[0].count !== 0) {
    fail("Benchmark students already have today's practice rows; refusing to overwrite synthetic data.");
  }
}

async function prepareHeartbeat(pool, runId, scenarioId, count) {
  await assertNoCurrentDayPractice(pool, count);
  const ids = Array.from({ length: count }, (_, index) => studentId(index + 1));
  const sessions = Array.from({ length: count }, (_, index) =>
    sessionId(runId, scenarioId, index + 1),
  );
  await pool.query(
    `insert into public.speaking_sessions
       (id, student_id, assignment_id, attempt_number, seconds_accumulated,
        status, started_at, last_heartbeat_at)
     select s.session_id, s.student_id, null, null, 0, 'active',
            now() - interval '120 seconds', now() - interval '120 seconds'
     from unnest($1::uuid[], $2::uuid[]) as s(session_id, student_id)`,
    [sessions, ids],
  );
}

async function verifyAndCleanHeartbeat(pool, runId, scenarioId, count) {
  const prefix = sessionPrefix(runId);
  const { rows } = await pool.query(
    `select s.id::text, s.student_id::text, s.seconds_accumulated,
            p.seconds_practiced
     from public.speaking_sessions s
     left join public.practice_sessions p
       on p.student_id = s.student_id and p.session_date = current_date
     where s.id::text like $1
       and substring(s.id::text from 29 for 4) = $2`,
    [prefix, String(scenarioId).padStart(4, "0")],
  );
  const correctlyCredited =
    rows.length === count &&
    rows.every(
      (row) =>
        Number(row.seconds_accumulated) === 60 &&
        Number(row.seconds_practiced) === 60,
    );

  await pool.query(
    `delete from public.practice_sessions p
     using public.speaking_sessions s
     where p.student_id = s.student_id
       and p.session_date = current_date
       and s.id::text like $1
       and substring(s.id::text from 29 for 4) = $2`,
    [prefix, String(scenarioId).padStart(4, "0")],
  );
  await pool.query(
    `delete from public.speaking_sessions
     where id::text like $1
       and substring(id::text from 29 for 4) = $2`,
    [prefix, String(scenarioId).padStart(4, "0")],
  );

  if (!correctlyCredited) {
    fail(
      `Heartbeat API/database mismatch at scenario ${scenarioId}: ` +
        `expected ${count} rows with 60 credited seconds; found ${rows.length}.`,
    );
  }
  return {
    requestCount: count,
    expectedCreditPerRequestSeconds: 60,
    databaseRowsVerified: rows.length,
    databaseTotalsMatched: correctlyCredited,
  };
}

async function prepareCorrectness(pool, runId, scenarioId, kind, vuCount) {
  const student = studentId(1);
  await assertNoCurrentDayPractice(pool, 1);
  if (kind === "heartbeat-correctness") {
    const cappedSession = sessionId(runId, scenarioId, 1);
    const endedSession = sessionId(runId, scenarioId, 2);
    const unownedAssignment =
      `21000000-0000-4000-8000-${runId}${String(scenarioId).padStart(4, "0")}0000`;
    await pool.query(
      `insert into public.assignments (id, title, format_type, description)
       values ($1, $2, 'extempore', 'Synthetic unassigned ownership check')`,
      [unownedAssignment, `LOADTEST-${runId}-${scenarioId}-ownership`],
    );
    await pool.query(
      `insert into public.speaking_sessions
       (id, student_id, assignment_id, attempt_number, seconds_accumulated,
        status, started_at, last_heartbeat_at, ended_at)
       values
         ($1, $3, null, null, 0, 'active', now() - interval '120 seconds',
          now() - interval '120 seconds', null),
         ($2, $3, null, null, 0, 'ended', now() - interval '120 seconds',
          now() - interval '120 seconds', now() - interval '60 seconds')`,
      [cappedSession, endedSession, student],
    );
    await pool.query(
      `insert into public.practice_sessions (student_id, session_date, seconds_practiced)
       values ($1, current_date, 1740)`,
      [student],
    );
  } else if (kind === "heartbeat-race") {
    const commonSession = sessionId(runId, scenarioId, 1);
    const { rows } = await pool.query(
      `insert into public.speaking_sessions
       (id, student_id, assignment_id, attempt_number, seconds_accumulated,
        status, started_at, last_heartbeat_at)
       values ($1, $2, null, null, 0, 'active',
               now(), now())
       returning last_heartbeat_at`,
      [commonSession, student],
    );
    if (vuCount !== 25) fail("Same-student race must use exactly 25 virtual users.");
    return { startWatermark: rows[0].last_heartbeat_at };
  }
  return null;
}

async function verifyAndCleanCorrectness(pool, runId, scenarioId, kind, setup) {
  const prefix = sessionPrefix(runId);
  const student = studentId(1);
  let result;
  if (kind === "heartbeat-correctness") {
    const cappedId = sessionId(runId, scenarioId, 1);
    const endedId = sessionId(runId, scenarioId, 2);
    const { rows } = await pool.query(
      `select s.id::text, s.status::text, s.seconds_accumulated,
              p.seconds_practiced
       from public.speaking_sessions s
       left join public.practice_sessions p
         on p.student_id = s.student_id and p.session_date = current_date
       where s.id = any($1::uuid[])`,
      [[cappedId, endedId]],
    );
    const ownershipSession = sessionId(runId, scenarioId, 3);
    const ownershipResult = await pool.query(
      `select count(*)::int as count
       from public.speaking_sessions where id = $1`,
      [ownershipSession],
    );
    const capPassed =
      rows.length === 2 &&
      Number(rows.find((row) => row.id === cappedId)?.seconds_accumulated) === 60 &&
      Number(rows.find((row) => row.id === cappedId)?.seconds_practiced) === 1800 &&
      rows.find((row) => row.id === endedId)?.status === "ended" &&
      Number(rows.find((row) => row.id === endedId)?.seconds_accumulated) === 0 &&
      ownershipResult.rows[0].count === 0;
    result = {
      dailyCap: capPassed,
      expectedDailySeconds: 1800,
      actualDailySeconds: rows.find((row) => row.id === cappedId)?.seconds_practiced ?? null,
      cappedSessionSeconds: rows.find((row) => row.id === cappedId)?.seconds_accumulated ?? null,
      endedSessionUnchanged:
        rows.find((row) => row.id === endedId)?.status === "ended" &&
        Number(rows.find((row) => row.id === endedId)?.seconds_accumulated) === 0,
      unownedSessionNotCreated: ownershipResult.rows[0].count === 0,
    };
  } else {
    const raceId = sessionId(runId, scenarioId, 1);
    const { rows } = await pool.query(
      `select s.seconds_accumulated, s.last_heartbeat_at, p.seconds_practiced
       from public.speaking_sessions s
       left join public.practice_sessions p
         on p.student_id = s.student_id and p.session_date = current_date
       where s.id = $1`,
      [raceId],
    );
    const seconds = Number(rows[0]?.seconds_accumulated ?? -1);
    const daily = Number(rows[0]?.seconds_practiced ?? -1);
    const watermarkElapsed = rows[0]
      ? await pool.query(
          `select floor(extract(epoch from ($1::timestamptz - $2::timestamptz)))::int as elapsed`,
          [rows[0].last_heartbeat_at, setup.startWatermark],
        )
      : { rows: [{ elapsed: -1 }] };
    const elapsedBound = Math.min(60, Number(watermarkElapsed.rows[0]?.elapsed ?? -1));
    result = {
      simultaneousRequests: 25,
      elapsedSecondsFromInitialWatermark: elapsedBound,
      expectedCreditUpperBoundSeconds: Math.min(60, elapsedBound),
      sessionSeconds: seconds,
      dailySeconds: daily,
      noOverCredit:
        seconds >= 0 &&
        seconds <= Math.min(60, elapsedBound) &&
        daily === seconds &&
        seconds <= 60,
    };
  }

  await pool.query(
    `delete from public.practice_sessions p
     using public.speaking_sessions s
     where p.student_id = s.student_id
       and p.session_date = current_date
       and s.id::text like $1
       and s.student_id = $2`,
    [prefix, student],
  );
  await pool.query(
    `delete from public.speaking_sessions
     where id::text like $1 and student_id = $2`,
    [prefix, student],
  );
  await pool.query(
    `delete from public.assignments
     where title = $1`,
    [`LOADTEST-${runId}-${scenarioId}-ownership`],
  );
  if (kind === "heartbeat-race" && !result.noOverCredit) {
    fail(`Same-student concurrent heartbeat over-credit check failed: ${JSON.stringify(result)}`);
  }
  if (kind === "heartbeat-correctness" && !result.dailyCap) {
    fail(`Daily-cap/ended-session verification failed: ${JSON.stringify(result)}`);
  }
  return result;
}

async function verifyAndCleanAssignment(pool, runId, scenarioId, count) {
  const prefix = `LOADTEST-${runId}-${String(scenarioId).padStart(4, "0")}-`;
  const { rows } = await pool.query(
    `select count(distinct a.id)::int as assignments,
            count(sa.id)::int as distributions
     from public.assignments a
     left join public.student_assignments sa on sa.assignment_id = a.id
     where a.title like $1`,
    [`${prefix}%`],
  );
  const assignments = Number(rows[0].assignments);
  const distributions = Number(rows[0].distributions);
  const passed = assignments === count && distributions === count * 300;
  await pool.query(`delete from public.assignments where title like $1`, [`${prefix}%`]);
  if (!passed) {
    fail(
      `Assignment route/database mismatch: expected ${count} assignments and ${count * 300} distributions; ` +
        `actual ${assignments} and ${distributions}.`,
    );
  }
  return { assignments, distributions, expectedDistributions: count * 300, passed };
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      env: options.env ?? process.env,
      stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
    });
    let stdout = "";
    let stderr = "";
    if (options.capture) {
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk) => {
        stdout = (stdout + chunk).slice(-12_000);
      });
      child.stderr.on("data", (chunk) => {
        stderr = (stderr + chunk).slice(-12_000);
      });
    }
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else {
        const detail = `${stdout}\n${stderr}`.trim();
        reject(new Error(`${command} exited with ${code ?? "no code"}.\n${detail}`));
      }
    });
  });
}

async function startServer(localEnv) {
  const child = spawn(
    process.execPath,
    [
      path.join(root, "node_modules/next/dist/bin/next"),
      "start",
      "--hostname",
      "127.0.0.1",
      "--port",
      "3100",
    ],
    {
      cwd: root,
      env: localEnv,
      stdio: "inherit",
    },
  );

  const startedAt = Date.now();
  while (Date.now() - startedAt < 90_000) {
    if (child.exitCode !== null) fail("Local Next.js server exited during startup.");
    try {
      const response = await fetch(`${appUrl}/login`, { signal: AbortSignal.timeout(1500) });
      if (response.status === 200) return child;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  child.kill("SIGTERM");
  fail("Local Next.js server did not become ready at /login.");
}

async function stopServer(child) {
  if (!child || child.exitCode !== null) return;
  child.kill("SIGTERM");
  await new Promise((resolve) => {
    const timer = setTimeout(resolve, 5000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

function runLabel(operation, vus, repetition) {
  return `${operation}-vu${vus}-rep${repetition}`;
}

async function executeK6({
  config,
  runId,
  scenarioId,
  operation,
  vus,
  repetition,
  resultDir,
}) {
  const label = runLabel(operation, vus, repetition);
  const rawPath = path.join(resultDir, `${label}.ndjson`);
  const summaryPath = path.join(resultDir, `${label}.summary.json`);
  const k6Variables = {
    BASE_URL: appUrl,
    LOCAL_SUPABASE_URL: config.API_URL,
    LOCAL_SUPABASE_ANON_KEY: config.ANON_KEY,
    RUN_ID: runId,
    SCENARIO_ID: String(scenarioId),
    OP: operation,
    VUS: String(vus),
    REP: String(repetition),
    SUMMARY_PATH: summaryPath,
  };
  const k6Args = ["run", "--quiet"];
  for (const [name, value] of Object.entries(k6Variables)) {
    k6Args.push("--env", `${name}=${value}`);
  }
  k6Args.push("--out", `json=${rawPath}`, path.join(loadTestDir, "api.js"));
  await runCommand(
    "k6",
    k6Args,
    { capture: true },
  );
  const summary = JSON.parse(await readFile(summaryPath, "utf8"));
  const metrics = summary.metrics ?? {};
  const metricValues = (name) => metrics[name]?.values ?? {};
  const rawLines = (await readFile(rawPath, "utf8")).split(/\r?\n/);
  const requestPoints = rawLines.flatMap((line) => {
    if (!line) return [];
    const point = JSON.parse(line);
    if (
      point.metric !== "http_req_duration" ||
      point.data?.tags?.endpoint !== operation
    ) {
      return [];
    }
    const endMs = Date.parse(point.data.time);
    return [{ startMs: endMs - Number(point.data.value), endMs }];
  });
  if (requestPoints.length === 0) fail(`${label} produced no endpoint timing samples.`);
  const waveStartMs = Math.min(...requestPoints.map((point) => point.startMs));
  const waveEndMs = Math.max(...requestPoints.map((point) => point.endMs));
  const waveDurationSeconds = Math.max((waveEndMs - waveStartMs) / 1000, 0.001);
  const result = {
    operation,
    virtualUsers: vus,
    repetition,
    requestCount: Number(metricValues("api_requests").count ?? 0),
    successfulRequests: Number(metricValues("api_successes").count ?? 0),
    failedRequests: Number(metricValues("api_failures").count ?? 0),
    timeouts: Number(metricValues("api_timeouts").count ?? 0),
    averageMs: Number(metricValues("api_response_time").avg ?? 0),
    p50Ms: Number(
      metricValues("api_response_time")["p(50)"] ??
        metricValues("api_response_time").med ??
        0,
    ),
    p95Ms: Number(metricValues("api_response_time")["p(95)"] ?? 0),
    p99Ms: Number(metricValues("api_response_time")["p(99)"] ?? 0),
    throughputRps: requestPoints.length / waveDurationSeconds,
    scenarioRateRps: Number(metricValues("api_requests").rate ?? 0),
    rawOutput: path.relative(root, rawPath),
    summaryOutput: path.relative(root, summaryPath),
  };
  result.httpErrorRate =
    result.requestCount > 0 ? result.failedRequests / result.requestCount : 0;
  const expectedRequests =
    operation === "heartbeat-correctness" ? 4 : vus;
  if (
    result.requestCount !== expectedRequests ||
    result.successfulRequests !== expectedRequests ||
    result.failedRequests !== 0 ||
    result.timeouts !== 0
  ) {
    fail(
      `${label} failed endpoint checks: ${result.successfulRequests}/${result.requestCount} correct, ` +
        `${result.timeouts} timeouts.`,
    );
  }
  console.log(
    `${label}: ${result.successfulRequests}/${result.requestCount} correct, ` +
      `avg ${result.averageMs.toFixed(2)} ms, p95 ${result.p95Ms.toFixed(2)} ms, ` +
      `timeouts ${result.timeouts}`,
  );
  return result;
}

async function runBenchmark(pool, config, smokeOnly = false) {
  const runId = randomBytes(2).toString("hex");
  const resultDir = path.join(
    resultsRoot,
    `run-${new Date().toISOString().replace(/[-:.TZ]/g, "")}-${runId}`,
  );
  await mkdir(resultDir, { recursive: true });

  const localEnv = {
    ...process.env,
    NEXT_PUBLIC_SUPABASE_URL: config.API_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: config.ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: config.SERVICE_ROLE_KEY,
    NODE_ENV: "production",
  };
  await runCommand("npm", ["run", "build"], { env: localEnv });

  let server;
  const benchmarkResults = [];
  const correctnessResults = [];
  const runMetadata = {
    runId,
    startedAt: new Date().toISOString(),
    environment: {
      platform: process.platform,
      architecture: process.arch,
      node: process.version,
      cpuCount: os.cpus().length,
      totalMemoryBytes: os.totalmem(),
      postgresVersion:
        (await pool.query("show server_version")).rows[0]?.server_version,
      k6Version: execFileSync("k6", ["version"], { encoding: "utf8" }).trim(),
      appUrl,
      supabaseUrl: new URL(config.API_URL).origin,
      syntheticStudents: 300,
      syntheticAssignments: 10,
      syntheticDistributions: 3000,
      streakRows: 400,
      rampUpSeconds: 2,
      requestWaveOffsetSeconds: 3,
      requestsPerVirtualUser: 1,
      repetitionsPerConcurrency: 3,
    },
    warmup: [],
    correctness: [],
    benchmark: [],
  };

  try {
    server = await startServer(localEnv);
    let scenarioId = 1;

    for (const operation of operations) {
      const count = 1;
      if (operation === "heartbeat") {
        await prepareHeartbeat(pool, runId, scenarioId, count);
      }
      const result = await executeK6({
        config,
        runId,
        scenarioId,
        operation,
        vus: 1,
        repetition: "warmup",
        resultDir,
      });
      if (operation === "heartbeat") {
        const verification = await verifyAndCleanHeartbeat(pool, runId, scenarioId, 1);
        runMetadata.warmup.push({ ...result, databaseVerification: verification });
      } else if (operation === "assignment") {
        const verification = await verifyAndCleanAssignment(pool, runId, scenarioId, 1);
        runMetadata.warmup.push({ ...result, databaseVerification: verification });
      } else {
        runMetadata.warmup.push(result);
      }
      scenarioId += 1;
    }

    scenarioId += 1;
    await prepareCorrectness(pool, runId, scenarioId, "heartbeat-correctness", 1);
    const capCheck = await executeK6({
      config,
      runId,
      scenarioId,
      operation: "heartbeat-correctness",
      vus: 1,
      repetition: "correctness",
      resultDir,
    });
    correctnessResults.push({
      operation: "daily-cap-duplicate-expired-ownership",
      ...capCheck,
      databaseVerification: await verifyAndCleanCorrectness(
        pool,
        runId,
        scenarioId,
        "heartbeat-correctness",
      ),
    });

    scenarioId += 1;
    const raceSetup = await prepareCorrectness(
      pool,
      runId,
      scenarioId,
      "heartbeat-race",
      25,
    );
    const raceCheck = await executeK6({
      config,
      runId,
      scenarioId,
      operation: "heartbeat-race",
      vus: 25,
      repetition: "correctness",
      resultDir,
    });
    correctnessResults.push({
      operation: "same-student-concurrent-heartbeats",
      ...raceCheck,
      databaseVerification: await verifyAndCleanCorrectness(
        pool,
        runId,
        scenarioId,
        "heartbeat-race",
        raceSetup,
      ),
    });
    runMetadata.correctness = correctnessResults;

    if (smokeOnly) {
      runMetadata.completedAt = new Date().toISOString();
      runMetadata.localResultsOnly = true;
      await writeFile(
        path.join(resultDir, "api-load-smoke-results.json"),
        JSON.stringify(runMetadata, null, 2),
      );
      console.log(
        `Smoke results: ${path.relative(root, path.join(resultDir, "api-load-smoke-results.json"))}`,
      );
      return;
    }

    for (const operation of operations) {
      for (const vus of concurrencyLevels) {
        for (let repetition = 1; repetition <= 3; repetition += 1) {
          scenarioId += 1;
          if (operation === "heartbeat") {
            await prepareHeartbeat(pool, runId, scenarioId, vus);
          }
          const result = await executeK6({
            config,
            runId,
            scenarioId,
            operation,
            vus,
            repetition,
            resultDir,
          });
          if (operation === "heartbeat") {
            result.databaseVerification = await verifyAndCleanHeartbeat(
              pool,
              runId,
              scenarioId,
              vus,
            );
          } else if (operation === "assignment") {
            result.databaseVerification = await verifyAndCleanAssignment(
              pool,
              runId,
              scenarioId,
              vus,
            );
          }
          benchmarkResults.push(result);
        }
      }
    }

    const aggregate = aggregateResults(benchmarkResults);
    runMetadata.benchmark = benchmarkResults;
    runMetadata.medianByEndpointAndConcurrency = aggregate;
    runMetadata.completedAt = new Date().toISOString();
    runMetadata.localResultsOnly = true;
    await writeFile(
      path.join(resultDir, "api-load-results.json"),
      JSON.stringify(runMetadata, null, 2),
    );
    await writeFile(
      path.join(resultsRoot, "latest.json"),
      JSON.stringify(
        {
          resultDirectory: path.relative(root, resultDir),
          resultFile: path.relative(root, path.join(resultDir, "api-load-results.json")),
          generatedAt: runMetadata.completedAt,
        },
        null,
        2,
      ),
    );
    console.log(`\nResults: ${path.relative(root, path.join(resultDir, "api-load-results.json"))}`);
  } catch (error) {
    await cleanupRun(pool, runId);
    throw error;
  } finally {
    await stopServer(server);
  }
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function aggregateResults(results) {
  const grouped = new Map();
  for (const row of results) {
    const key = `${row.operation}:${row.virtualUsers}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(row);
  }
  return [...grouped.entries()].map(([key, reps]) => {
    const [operation, virtualUsers] = key.split(":");
    const metric = (name) => median(reps.map((row) => Number(row[name])));
    return {
      operation,
      virtualUsers: Number(virtualUsers),
      requestCount: median(reps.map((row) => row.requestCount)),
      successfulRequests: median(reps.map((row) => row.successfulRequests)),
      failedRequests: median(reps.map((row) => row.failedRequests)),
      averageMs: metric("averageMs"),
      p50Ms: metric("p50Ms"),
      p95Ms: metric("p95Ms"),
      p99Ms: metric("p99Ms"),
      throughputRps: metric("throughputRps"),
      httpErrorRate: metric("httpErrorRate"),
      timeouts: median(reps.map((row) => row.timeouts)),
      repetitions: reps.length,
    };
  });
}

async function cleanupRun(pool, runId) {
  const prefix = sessionPrefix(runId);
  await pool.query(
    `delete from public.practice_sessions p
     using public.speaking_sessions s
     where p.student_id = s.student_id
       and p.session_date = current_date
       and s.id::text like $1`,
    [prefix],
  );
  await pool.query(`delete from public.speaking_sessions where id::text like $1`, [prefix]);
  await pool.query(`delete from public.assignments where title like $1`, [`LOADTEST-${runId}-%`]);
}

async function main() {
  const mode = process.argv[2] || "benchmark";
  const config = getLocalSupabaseConfig();
  const pool = makePool(config);
  try {
    await pool.query("select 1");
    if (mode === "setup" || mode === "benchmark" || mode === "smoke") {
      await installSyntheticInstructor(pool);
      const baseline = await assertBaseline(pool);
      console.log(
        `Local-only synthetic fixture ready: ${baseline.students} students, ` +
          `${baseline.assignments} assignments, ${baseline.distributions} distributions, ` +
          `${baseline.streak_days} streak rows.`,
      );
    }
    if (mode === "cleanup") {
      const result = await pool.query(`
        delete from public.assignments where title like 'LOADTEST-%'
        returning id
      `);
      await pool.query(`
        delete from public.practice_sessions p
        using public.speaking_sessions s
        where p.student_id = s.student_id
          and p.session_date = current_date
          and s.id::text like '40000000-0000-4000-8000-%'
      `);
      await pool.query(`
        delete from public.speaking_sessions
        where id::text like '40000000-0000-4000-8000-%'
      `);
      console.log(`Removed ${result.rowCount} synthetic LOADTEST assignments and scoped heartbeat fixtures.`);
      return;
    }
    if (mode === "setup") return;
    if (mode !== "benchmark" && mode !== "smoke") {
      fail("Use setup, benchmark, smoke, or cleanup mode.");
    }
    await runBenchmark(pool, config, mode === "smoke");
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Local load-test failed.");
  process.exitCode = 1;
});
