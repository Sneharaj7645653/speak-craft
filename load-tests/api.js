import http from "k6/http";
import { check, sleep } from "k6";
import exec from "k6/execution";
import { Counter, Trend } from "k6/metrics";
import { b64encode } from "k6/encoding";

const operation = __ENV.OP;
const targetVus = Number(__ENV.VUS || 1);
const repetition = String(__ENV.REP || "warmup");
const scenarioId = Number(__ENV.SCENARIO_ID || 1);
const runId = String(__ENV.RUN_ID || "");
const baseUrl = String(__ENV.BASE_URL || "");
const supabaseUrl = String(__ENV.LOCAL_SUPABASE_URL || "");
const anonKey = String(__ENV.LOCAL_SUPABASE_ANON_KEY || "");

const requests = new Counter("api_requests");
const successes = new Counter("api_successes");
const failures = new Counter("api_failures");
const timeouts = new Counter("api_timeouts");
const responseTime = new Trend("api_response_time", true);

const benchmarkOperations = new Set(["heartbeat", "streak", "metrics", "assignment"]);
const correctnessOperations = new Set([
  "heartbeat-race",
  "heartbeat-correctness",
]);

function isLoopback(value) {
  return /^https?:\/\/(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?(?:\/|$)/i.test(
    value,
  );
}

if (!isLoopback(baseUrl) || !isLoopback(supabaseUrl)) {
  throw new Error("Load tests require loopback-only application and Supabase URLs.");
}
if (!anonKey || !runId || !/^[a-f0-9]{4}$/i.test(runId)) {
  throw new Error("Missing local test configuration.");
}
if (
  !benchmarkOperations.has(operation) &&
  !correctnessOperations.has(operation)
) {
  throw new Error("Unsupported load-test operation.");
}
if (!Number.isInteger(targetVus) || targetVus < 1 || targetVus > 100) {
  throw new Error("Virtual users must be between 1 and 100.");
}

export const options = {
  scenarios: {
    api_load: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "2s", target: targetVus },
        { duration: "4s", target: targetVus },
        { duration: "1s", target: 0 },
      ],
      gracefulRampDown: "1s",
      exec: "runRequest",
      tags: {
        operation,
        target_vus: String(targetVus),
        repetition,
      },
    },
  },
  summaryTrendStats: ["avg", "med", "p(50)", "p(95)", "p(99)"],
};

function makeCookie(session) {
  const authority = supabaseUrl.replace(/^https?:\/\//i, "").split(/[/?#]/, 1)[0];
  const hostname = authority.startsWith("[")
    ? authority.slice(1, authority.indexOf("]"))
    : authority.split(":")[0];
  const projectRef = hostname.split(".")[0];
  const name = `sb-${projectRef}-auth-token`;
  return `${name}=base64-${b64encode(JSON.stringify(session), "url")}`;
}

function signIn(email, password) {
  const response = http.post(
    `${supabaseUrl.replace(/\/$/, "")}/auth/v1/token?grant_type=password`,
    JSON.stringify({ email, password }),
    {
      headers: {
        apikey: anonKey,
        "content-type": "application/json",
      },
      timeout: "20s",
      tags: { phase: "auth_setup" },
    },
  );
  if (response.status !== 200) {
    throw new Error(`Synthetic local sign-in failed (HTTP ${response.status}).`);
  }

  const session = response.json();
  if (!session || typeof session.access_token !== "string") {
    throw new Error("Synthetic local sign-in returned no session.");
  }
  return makeCookie(session);
}

export function setup() {
  const count =
    operation === "metrics" || operation === "assignment"
      ? 1
      : operation === "streak" || operation === "heartbeat-race"
        ? 1
        : operation === "heartbeat-correctness"
          ? 1
          : targetVus;
  const cookies = [];

  for (let index = 1; index <= count; index += 1) {
    const email =
      operation === "metrics" || operation === "assignment"
        ? "loadtest-instructor@local.test"
        : operation === "streak"
          ? "bench0300@local.test"
          : `bench${String(index).padStart(4, "0")}@local.test`;
    const password =
      operation === "metrics" || operation === "assignment"
        ? "loadtest-local-only-password"
        : "local-only-password";
    cookies.push(signIn(email, password));
  }
  return { cookies };
}

function sessionIdFor(vuId) {
  const suffix =
    runId +
    String(scenarioId).padStart(4, "0") +
    String(vuId).padStart(4, "0");
  return `40000000-0000-4000-8000-${suffix}`;
}

function jsonBody(response) {
  try {
    return response.json();
  } catch {
    return null;
  }
}

function issueRequest(method, path, body, cookie, predicate, expectedStatuses) {
  const options = {
    headers: {
      Cookie: cookie,
      Accept: "application/json",
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    timeout: "20s",
    tags: { endpoint: operation },
    ...(expectedStatuses
      ? { responseCallback: http.expectedStatuses(...expectedStatuses) }
      : {}),
  };
  const response = http.request(
    method,
    `${baseUrl}${path}`,
    body === undefined ? null : JSON.stringify(body),
    options,
  );
  requests.add(1);
  responseTime.add(response.timings.duration);

  const timedOut =
    response.status === 0 || /timeout|timed out/i.test(response.error || "");
  if (timedOut) timeouts.add(1);

  const bodyJson = jsonBody(response);
  const passed = predicate(response, bodyJson);
  check(response, { "API response satisfies endpoint contract": () => passed });
  if (passed) successes.add(1);
  else failures.add(1);
  return { response, body: bodyJson };
}

function waitForRequestWave() {
  const waveTime = exec.scenario.startTime + 3000;
  sleep(Math.max(0, (waveTime - Date.now()) / 1000));
}

export function runRequest(data) {
  if (exec.vu.iterationInScenario > 0) {
    sleep(10);
    return;
  }

  waitForRequestWave();
  const vuId = __VU;
  const cookie =
    operation === "metrics" || operation === "assignment"
      ? data.cookies[0]
      : operation === "streak"
        ? data.cookies[0]
        : operation === "heartbeat-race" ||
            operation === "heartbeat-correctness"
          ? data.cookies[0]
          : data.cookies[vuId - 1];

  if (operation === "heartbeat-correctness") {
    const sessionId = sessionIdFor(1);
    const heartbeatBody = { sessionId };
    const heartbeatPath = "/api/student/heartbeat";
    const expectedCap = (response, body) =>
      response.status === 200 &&
      body?.creditedSeconds === 60 &&
      body?.dailyTotalSeconds === 1800 &&
      body?.dailyCapReached === true;
    issueRequest("POST", heartbeatPath, heartbeatBody, cookie, expectedCap);
    issueRequest(
      "POST",
      heartbeatPath,
      heartbeatBody,
      cookie,
      (response, body) =>
        response.status === 200 &&
        body?.creditedSeconds === 0 &&
        body?.dailyTotalSeconds === 1800 &&
        body?.dailyCapReached === true,
    );
    issueRequest(
      "POST",
      heartbeatPath,
      { sessionId: sessionIdFor(2) },
      cookie,
      (response) => response.status === 403,
      [200, 403],
    );
    issueRequest(
      "POST",
      heartbeatPath,
      {
        sessionId: sessionIdFor(3),
        assignmentId: `21000000-0000-4000-8000-${runId}${String(scenarioId).padStart(4, "0")}0000`,
      },
      cookie,
      (response) => response.status === 403,
      [200, 403],
    );
    sleep(10);
    return;
  }

  if (operation === "heartbeat" || operation === "heartbeat-race") {
    const owner = operation === "heartbeat-race" ? 1 : vuId;
    issueRequest(
      "POST",
      "/api/student/heartbeat",
      { sessionId: sessionIdFor(owner) },
      cookie,
      (response, body) =>
        response.status === 200 &&
        Number.isInteger(body?.creditedSeconds) &&
        body.creditedSeconds >= 0 &&
        body.creditedSeconds <= 60 &&
        body.dailyTotalSeconds <= 1800 &&
        body.sessionSeconds <= 1800 &&
        (operation !== "heartbeat" ||
          (body.creditedSeconds === 60 &&
            body.sessionSeconds === 60 &&
            body.dailyTotalSeconds === 60)),
    );
  } else if (operation === "streak") {
    issueRequest(
      "GET",
      "/api/student/streak",
      undefined,
      cookie,
      (response, body) =>
        response.status === 200 &&
        Array.isArray(body?.history) &&
        body.history.length === 400 &&
        body?.dailyGoalSeconds === 600,
    );
  } else if (operation === "metrics") {
    issueRequest(
      "GET",
      "/api/instructor/metrics",
      undefined,
      cookie,
      (response, body) =>
        response.status === 200 &&
        Array.isArray(body?.students) &&
        body?.studentCount === 300 &&
        body.students.length === 300,
    );
  } else if (operation === "assignment") {
    issueRequest(
      "POST",
      "/api/instructor/create-assignment",
      {
        title: `LOADTEST-${runId}-${String(scenarioId).padStart(4, "0")}-${String(vuId).padStart(4, "0")}`,
        formatType: "extempore",
        description: "Synthetic API load-test assignment.",
      },
      cookie,
      (response, body) =>
        response.status === 201 && body?.recipientCount === 300,
    );
  }

  sleep(10);
}

export function handleSummary(data) {
  const summaryPath = __ENV.SUMMARY_PATH;
  if (!summaryPath) {
    throw new Error("SUMMARY_PATH is required.");
  }
  const safeSummary = { ...data };
  delete safeSummary.setup_data;
  return { [summaryPath]: JSON.stringify(safeSummary, null, 2) };
}
