# Engineering Quality, Testing & Performance Report

## 1. Executive Summary

This engagement audited and improved the SpeakCraft repository through implementation, automated testing, browser verification, local benchmarking, build/type/lint validation, dependency review, and static database analysis.

### What was investigated

- Next.js 14 App Router architecture and route boundaries
- Supabase Auth/PostgreSQL access patterns
- Roster upload and assignment distribution
- Student heartbeat and streak calculation
- AI coach streaming/failover behavior
- Existing build, test, lint, dependency, and environment configuration
- Runtime dependency advisories
- Frontend bundle and Lighthouse behavior

### What was implemented

- Added Vitest unit/integration test infrastructure.
- Added Playwright Chromium end-to-end tests for public auth pages.
- Added ESLint configuration and a reliable lint script.
- Added Vitest coverage tooling.
- Added 25 unit tests across authentication, roster, assignment, student practice, and AI behavior.
- Added 3 Playwright browser tests.
- Added an atomic `record_practice_heartbeat` PostgreSQL RPC and migration.
- Added a 25-second provider-side stream timeout/cancellation signal to the AI coach path.
- Replaced the client-read-modify-write heartbeat path with the atomic RPC call.
- Replaced credential-like values in `.env.local.example` with placeholders.
- Added a final engineering report and measurable verification evidence.

### What improved

- Heartbeat writes are now designed to be serialized and atomic at the database level.
- The application now has automated regression coverage instead of zero project-owned tests.
- The lint command now works without an interactive setup prompt.
- Public browser flows are independently executable with Playwright.
- AI providers receive a 25-second timeout and request cancellation signal.
- The environment example no longer contains sample credential-like values.

### What remains unresolved

- The heartbeat migration has been authored but was not applied to a live Supabase project.
- Live Supabase-backed endpoint measurements were not run because live database/auth access could not be verified.
- Groq/Gemini provider behavior was not exercised against real paid APIs.
- Lighthouse before/after comparison was not available because Lighthouse/Chrome were absent at the initial baseline.
- The Next.js 14 dependency advisory remains unresolved and requires an explicitly approved framework-major migration.
- Production rate limiting, CSRF/CORS/CSP policies, monitoring, and live CI/CD remain infrastructure decisions outside the repository evidence.

## 2. Initial Repository Audit

### Existing architecture

SpeakCraft is a Next.js 14 App Router application with:

- React 18 client components
- Strict TypeScript
- Tailwind CSS
- Supabase Auth and PostgreSQL
- Supabase service-role repositories
- Node.js route handlers
- An Edge `/api/coach/analyze` route
- Groq primary and Gemini fallback LLM streaming
- Browser Web Speech APIs

### Existing testing infrastructure

Before implementation:

- No project-owned test files
- No test script
- No test framework
- No browser test framework
- No coverage configuration
- No ESLint configuration
- No CI workflow

### Existing performance tooling

Before implementation:

- k6 was not installed.
- Lighthouse was not installed.
- Chrome/Chromium was not available.
- Docker was available but no load-test or browser fixture was present.
- No application load-test script was present.

### Initial technical weaknesses

The most evidence-backed weaknesses were:

1. Heartbeat accounting used multiple application reads/writes and was not transaction-wrapped.
2. The assignment fan-out was chunked but compensation was best-effort.
3. AI provider calls had SDK defaults and no explicit application-level 25-second timeout.
4. `.env.local.example` contained credential-like values.
5. The repository had no automated tests or lint configuration.
6. Dependency auditing identified vulnerable runtime/transitive packages.

### Constraints

- Repository state was not available as a Git repository, so Git working-tree/diff verification was unavailable.
- Live Supabase credentials, provider credentials, production data, and deployed infrastructure were not modified or used.
- No paid LLM requests were made.
- No production database migrations were applied.
- No destructive or external-mutating API calls were made.

## 3. Baseline Measurements

### Benchmark environment

- Host: macOS
- Node: `v26.3.1`
- npm: `11.16.0`
- Application: Next.js `14.2.35`
- Benchmark mechanism: Node `fetch` concurrent batches against the locally running production server
- Route samples:
  - `GET /login`
  - `POST /api/auth/signup` with malformed JSON
- Virtual-concurrency values: 10, 25, 50, 100
- Each concurrency level ran 5 iterations.
- The malformed signup request is a safe local validation path and does not create an account or call Supabase.

### Initial API baseline

| Route | Virtual users | Requests | Average | Median | p95 | p99 | Throughput | Server error rate |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| `GET /login` | 10 | 50 | 13.08 ms | 9.92 ms | 22.35 ms | 50.77 ms | 470.40 req/s | 0% |
| `GET /login` | 25 | 125 | 15.56 ms | 17.24 ms | 19.83 ms | 21.26 ms | 1227.08 req/s | 0% |
| `GET /login` | 50 | 250 | 26.08 ms | 30.17 ms | 33.72 ms | 34.98 ms | 1473.69 req/s | 0% |
| `GET /login` | 100 | 500 | 40.77 ms | 42.91 ms | 53.13 ms | 53.57 ms | 1969.71 req/s | 0% |
| Malformed `POST /api/auth/signup` | 10 | 50 | 4.02 ms | 3.70 ms | 7.07 ms | 7.73 ms | 1498.95 req/s | 0 server-5xx |
| Malformed `POST /api/auth/signup` | 25 | 125 | 8.82 ms | 6.32 ms | 34.50 ms | 36.41 ms | 1562.96 req/s | 0 server-5xx |
| Malformed `POST /api/auth/signup` | 50 | 250 | 7.74 ms | 7.59 ms | 12.46 ms | 13.73 ms | 3696.29 req/s | 0 server-5xx |
| Malformed `POST /api/auth/signup` | 100 | 500 | 12.17 ms | 11.37 ms | 21.99 ms | 24.50 ms | 4680.78 req/s | 0 server-5xx |

The initial benchmark harness initially labeled HTTP 400 responses as application errors. This was corrected in the post-change run. In the table above, malformed signup is a deliberately expected `400`, not a server error.

### Initial frontend measurements

No Lighthouse baseline was possible because Lighthouse and Chrome were absent.

### Initial build validation

- `npm run typecheck`: passed
- `npm run build`: passed
- `npm run lint`: failed by prompting for interactive ESLint setup; no lint configuration existed
- Unit tests: none existed
- Browser tests: none existed

### Database findings

Static migration inspection found:

- Indexed `speaking_sessions(student_id)` and `(assignment_id, student_id)`
- Indexed `practice_sessions(student_id, session_date DESC)`
- Unique `(student_id, session_date)`
- Unique `(assignment_id, student_id)`
- Unique formal attempt `(assignment_id, student_id, attempt_number)`
- The old heartbeat implementation performed session read, ownership read, daily read, session update, and daily upsert outside one database transaction.
- The compliance view aggregates assignments and practice sessions in separate subqueries, avoiding cartesian join inflation.
- Roster pre-read and assignment fan-out are separate bounded database operations.

Live `EXPLAIN ANALYZE` was not executed because no live database approval or credentials were used.

### Limitations

- Live Supabase API latency and database plan data could not be measured.
- Paid provider latency and fallback timing could not be measured.
- k6 was not installed and no external browser load infrastructure was available.

## 4. Automated Testing

### Frameworks introduced

- Vitest `2.1.9`
- V8 coverage through `@vitest/coverage-v8` `2.1.9`
- Playwright `1.65.1`
- Playwright Chromium browser
- ESLint `8.57.1`
- `eslint-config-next` `14.2.35`
- Lighthouse `13.6.0`

### Unit test files

- `tests/dtos.test.ts`
- `tests/auth.service.test.ts`
- `tests/instructor.service.test.ts`
- `tests/student.service.test.ts`
- `tests/ai-coach.test.ts`
- `tests/server-only.ts`

### Browser test file

- `e2e/public-pages.spec.ts`

### Workflows covered

#### Workflow A: Authentication

- Valid signup DTO
- Invalid signup DTO
- Whitelist miss
- Whitelist role assignment
- Duplicate auth identity
- Profile persistence failure compensation

#### Workflow B: Instructor roster upload

- Valid CSV upload
- Duplicate entries
- Invalid structure
- Missing email candidates
- Uploads above 5,000 candidates
- Roster reconciliation

#### Workflow C: Assignment creation

- Valid assignment
- Missing title
- Invalid format
- Recipient distribution
- No-recipient rollback
- Distribution failure rollback
- Roster accounting

#### Workflow D: Student practice and streak tracking

- Atomic heartbeat delegation
- Formal-attempt heartbeat limit
- Streak calculation
- At least 10-minute qualifying-day logic
- Heartbeat and streak deterministic date handling

#### Workflow E: AI coaching

- Valid and invalid conversation payload
- Turn limits
- Missing student turn
- Provider configuration state
- Filler/word delivery metrics
- Empty transcript scoring bounds

### Test result counts

Final unit run:

- 5 test files
- 25 tests passed
- 0 failed
- 0 skipped

Final browser run:

- 3 Chromium tests passed
- 0 failed
- 0 skipped

### Coverage

Measured Vitest coverage:

- Statements: `42.87%`
- Branches: `71.69%`
- Functions: `38.59%`
- Lines: `42.87%`

This is source coverage across the backend modules included in the Vitest coverage configuration, not a claimed application-wide coverage percentage.

### Commands

```bash
npm test
npm run test:coverage
npm run test:e2e
```

## 5. Bottlenecks Identified

### 1. Heartbeat read-modify-write race

- **Problem:** The service read the session and daily row, then performed separate writes.
- **Evidence:** `src/backend/student/student.service.ts` previously implemented five application/database operations outside a transaction.
- **Severity:** HIGH
- **User impact:** Concurrent or repeated heartbeats could double credit or produce inconsistent daily totals.
- **Root cause:** Check/read/write sequencing without a database lock or transaction.

### 2. Provider timeout and cancellation uncertainty

- **Problem:** Provider streams had SDK defaults and no explicit application timeout/cancellation.
- **Evidence:** `AiCoachService` streamed directly from Groq/Gemini without a timeout signal.
- **Severity:** MEDIUM-HIGH
- **User impact:** Slow or hung provider calls could retain Edge requests and degrade practice availability.
- **Root cause:** External streaming lacked explicit deadline controls.

### 3. No automated regression protection

- **Problem:** No project tests or browser checks existed.
- **Evidence:** Package scripts and repository contained no project-owned test suite.
- **Severity:** HIGH for maintainability
- **User impact:** Authentication, heartbeat, roster, assignment, and AI changes could regress silently.
- **Root cause:** Missing test scaffolding and scripts.

### 4. Interactive/unconfigured linting

- **Problem:** `npm run lint` prompted for interactive setup.
- **Evidence:** Baseline `next lint` returned exit 1 after displaying an ESLint setup prompt.
- **Severity:** MEDIUM
- **User impact:** CI/developer lint verification was unreliable.
- **Root cause:** No ESLint configuration or direct lint script.

### 5. Credential-like example values

- **Problem:** `.env.local.example` contained populated credential-like values.
- **Evidence:** Supabase and AI variable lines appeared populated.
- **Severity:** HIGH if valid
- **User impact:** Secrets could be reused or distributed.
- **Root cause:** Environment template did not use placeholders.

### 6. Framework and transitive dependency advisories

- **Problem:** `npm audit` identified Next.js 14, PostCSS, Nanoid, and source-map advisories.
- **Evidence:** Runtime audit reported 1 critical, 3 high, and additional transitive concerns at the initial run.
- **Severity:** HIGH
- **User impact:** Potential DoS/XSS/path traversal exposure depending on deployment and feature use.
- **Root cause:** Framework/dependency versions require upgrade planning.

## 6. Improvements Implemented

### Atomic heartbeat RPC

**Changed**

- Added `supabase/migrations/0007_atomic_heartbeat_engine.sql`
- Added `recordPracticeHeartbeat()` to `src/backend/session/session.repository.ts`
- Updated `StudentService.recordHeartbeat()` in `src/backend/student/student.service.ts`
- Added the RPC argument contract to `src/lib/supabase/database.types.ts`

**Why**

- The old read-modify-write sequence allowed concurrent heartbeat duplication and did not enforce a database transaction.

**How**

- A per-student advisory transaction lock serializes heartbeats.
- The function validates a session's owner.
- It counts formal attempts and enforces the maximum inside the same transaction.
- It calculates elapsed time from the server watermark.
- It applies the per-beat and daily caps.
- It advances the watermark and upserts the daily accumulator.
- It returns the heartbeat DTO shape as JSON.
- Execute permission is granted only to `service_role`.

**Trade-offs**

- Database migration approval and application are required before production use.
- Per-student serialization is stronger than the old behavior and may add lock wait for very frequent concurrent heartbeats from the same student.

### AI provider timeout/cancellation

**Changed**

- Updated `src/app/api/coach/analyze/route.ts`
- Updated `src/backend/ai/ai-coach.service.ts`

**Why**

- The application needed an explicit provider deadline and client cancellation propagation.

**How**

- Coaching streams receive the browser request signal.
- A 25-second provider timeout signal is combined with browser cancellation.
- Groq receives timeout and `signal`.
- Gemini receives `abortSignal`.

**Tests**

- AI DTO and metrics tests passed.
- Live provider behavior is not measured because no real API call was made.

### Test and lint infrastructure

**Changed**

- Added Vitest, coverage, Playwright, Lighthouse, ESLint, and Next ESLint configuration.
- Added test scripts to `package.json`.
- Added test configuration and public-browser tests.

**Why**

- The baseline had no project-owned automated verification.

**Tests**

- 25 unit tests passed.
- 3 browser tests passed.
- Typecheck, lint, and build passed.

### Environment template hardening

**Changed**

- Replaced populated values in `.env.local.example` with placeholders.

**Why**

- Prevent copying credential-like values into source documentation.

**Limitation**

- The gitignored `.env.local` file may still contain real local values. It was not modified or printed.

## 7. Before-and-After Comparison

### API local benchmark

The route code is still largely unchanged for `/login` and malformed signup. The measured changes are within local benchmark noise and do not prove a latency improvement.

| Metric | Route | Before | After | Change |
|---|---|---:|---:|---|
| Average, 100 users | `GET /login` | 40.77 ms | 42.19 ms | No measured improvement |
| p95, 100 users | `GET /login` | 53.13 ms | 64.17 ms | No measured improvement |
| p99, 100 users | `GET /login` | 53.57 ms | 64.72 ms | No measured improvement |
| Throughput, 100 users | `GET /login` | 1969.71 req/s | 1697.21 req/s | No measured improvement |
| Average, 100 users | Malformed signup | 12.17 ms | 11.86 ms | 0.31 ms lower |
| p95, 100 users | Malformed signup | 21.99 ms | 19.59 ms | 2.40 ms lower |
| p99, 100 users | Malformed signup | 24.50 ms | 22.71 ms | 1.79 ms lower |
| Throughput, 100 users | Malformed signup | 4680.78 req/s | 4681.25 req/s | 0.47 req/s higher |
| Server 5xx | Both measured routes | 0% | 0% | No change |

The malformed-signup throughput/latency differences are too small and nonfunctional to claim a performance improvement.

### Automated verification

| Metric | Before | After |
|---|---:|---:|
| Unit tests | 0 | 25 passed |
| Browser tests | 0 | 3 passed |
| Vitest coverage | Unavailable | 42.87% statements |
| Typecheck | Passed | Passed |
| Lint | Interactive setup failure | Passed with 0 errors |
| Production build | Passed | Passed |

### Lighthouse

No initial Lighthouse result was captured. The post-change login measurement is:

| Metric | Result |
|---|---:|
| Performance | 99 |
| Accessibility | 95 |
| Best Practices | 96 |
| SEO | 100 |
| LCP | 0.8 s |
| CLS | 0 |
| TBT | 100 ms |
| FCP | 0.8 s |
| Total transfer size | 182 KiB |

No Lighthouse before/after improvement claim is made.

### Database improvement verification

The atomic heartbeat improvement is statically implemented and covered by service tests, but not measured against live PostgreSQL. It is therefore marked **implemented but not live-verified**.

## 8. Security and Reliability Findings

### Changes made

- `.env.local.example` now uses placeholders.
- AI provider calls now receive explicit cancellation/timeout signals.
- The heartbeat function is service-role-only.
- Public test flows use only local pages and no credentials.
- Tests use fake repositories and no real student data.

### Remaining findings

| Finding | Status | Action |
|---|---|---|
| Valid credential-like values may exist in `.env.local.example` history or local env | REQUIRES ROTATION | Rotate Supabase/AI credentials if they are or were valid |
| Next.js 14 known dependency advisories | UNRESOLVED | Plan a framework-major upgrade to a patched supported release |
| No API rate limiting | UNRESOLVED | Add route-level abuse/rate protection |
| No explicit CSRF/CSP/CORS review evidence | REQUIRES DEPLOYMENT CONFIRMATION | Verify proxy, headers, and same-origin settings |
| Evaluation transcripts persist text | REQUIRES POLICY | Define retention, export, deletion, and access policy |
| Assignment compensation deletes are best-effort | UNRESOLVED | Add stronger transaction or compensating workflow |
| Evaluation persistence is separate from attempt finalization | UNRESOLVED | Evaluate transactional persistence design |
| Live RLS and migration behavior | UNVERIFIED | Apply migrations in approved test/staging environment and test |

### Dependency audit

The runtime dependency audit after implementation still identified:

- Critical Next.js advisory coverage
- High Nanoid/PostCSS/source-map advisory coverage

The exact advisory set is environment/date dependent. Run `npm audit --omit=dev` to regenerate current results.

The dependency major upgrade was not applied because it would require React/framework compatibility validation and explicit migration approval.

## 9. Files Created and Modified

### New source/configuration files

- `supabase/migrations/0007_atomic_heartbeat_engine.sql`
- `vitest.config.ts`
- `.eslintrc.json`
- `playwright.config.ts`
- `tests/dtos.test.ts`
- `tests/auth.service.test.ts`
- `tests/instructor.service.test.ts`
- `tests/student.service.test.ts`
- `tests/ai-coach.test.ts`
- `tests/server-only.ts`
- `e2e/public-pages.spec.ts`
- `ENGINEERING_PERFORMANCE_REPORT.md`

### Modified application/configuration files

- `package.json`
- `package-lock.json`
- `.env.local.example`
- `src/backend/student/student.service.ts`
- `src/backend/session/session.repository.ts`
- `src/lib/supabase/database.types.ts`
- `src/app/api/coach/analyze/route.ts`
- `src/backend/ai/ai-coach.service.ts`

### Database migrations

- One new migration authored: `supabase/migrations/0007_atomic_heartbeat_engine.sql`
- No migration was applied to a live database.

### Generated directories removed

- `coverage/`
- `test-results/`

The `.next/` build directory is build output and was not treated as source evidence.

## 10. Commands and Reproducibility

### Prerequisites

- Node.js and npm
- Chromium installed via Playwright
- A local build
- Supabase variables in `.env.local` for protected/live flows
- Approved test/staging Supabase project for migrations

### Install

```bash
npm install
npx playwright install chromium
```

### Test

```bash
npm test
npm run test:coverage
npm run test:e2e
```

### Static validation

```bash
npm run typecheck
npm run lint
npm run build
```

### Start locally

```bash
npm run dev
# or
npm run build
npm run start
```

### Lighthouse

```bash
npx lighthouse http://127.0.0.1:3000/login \
  --chrome-flags='--headless --no-sandbox' \
  --only-categories=performance,accessibility,best-practices,seo \
  --output=json \
  --output-path=/tmp/speakcraft-lighthouse.json \
  --quiet
```

The exact Chrome executable may differ by platform. On this macOS machine, Playwright Chromium was used.

### Dependency review

```bash
npm audit --omit=dev
npm outdated
```

### Database migration

Apply only through an approved staging/test environment:

```bash
# Supabase CLI workflow, after environment/project selection
supabase db push
```

Do not apply migration `0007` to production without explicit approval and backup/rollback review.

### Local load benchmark

The benchmark used a temporary Node script and two safe routes:

```bash
npm run start
curl -sS -o /dev/null http://127.0.0.1:3000/login
```

For reproducible load, Node `fetch` can run the concurrency loop documented in this report. Live Supabase routes should not be load-tested until isolated test data and approved credentials are available.

## 11. Outstanding Issues

1. **Live migration not applied**
   - Reason: no live Supabase approval or credentials.
   - Next: apply 0007 to staging, run concurrency tests, then production after approval.

2. **Live database benchmark unavailable**
   - Reason: no safe Supabase test project.
   - Next: use isolated test credentials and `EXPLAIN ANALYZE`.

3. **Provider performance/failover not live-measured**
   - Reason: paid credentials and external requests were intentionally excluded.
   - Next: run controlled test-provider requests with mocks and a staging key.

4. **Framework dependency vulnerabilities unresolved**
   - Reason: Next.js major upgrade can alter framework/runtime behavior.
   - Next: perform a separate Next 14-to-patched-major upgrade with full regression tests.

5. **No live Lighthouse before measurement**
   - Reason: Lighthouse/Chrome was absent initially.
   - Next: run the exact Lighthouse command before future UI changes.

6. **No live rate limiting**
   - Reason: no infrastructure policy or provider configuration existed.
   - Next: add per-route throttle policy or edge proxy protection.

7. **No live observability**
   - Reason: no logging, tracing, or monitoring provider configuration exists.
   - Next: add structured logs and provider/latency metrics.

## 12. Resume-Ready Engineering Achievements

- Added 25 Vitest unit tests and 3 Playwright browser tests across authentication, instructor workflows, student practice, streak, and AI coaching behavior.
- Implemented an atomic PostgreSQL heartbeat RPC with per-student advisory locking and server-authoritative practice/day accounting.
- Added provider cancellation and 25-second timeout handling for Groq/Gemini Edge coaching streams.
- Established repeatable lint, typecheck, unit, coverage, browser, build, audit, benchmark, and Lighthouse verification workflows.
- Measured the local login path at 99 Lighthouse performance, 95 accessibility, 96 best-practices, and 100 SEO without claiming an unavailable before/after improvement.

## 13. FDE Interview Explanation

### 60-second explanation

I audited SpeakCraft end to end, established a safe local baseline, and found that the main reliability risk was the heartbeat engine using separate read and write operations for practice totals. I replaced it with a Postgres RPC that locks per student and updates the session watermark and daily accumulator transactionally. I also added Vitest and Playwright coverage around the real DTO and service behavior, fixed the environment example to use placeholders, and added a 25-second AI provider timeout. I measured the application locally, confirmed 25 unit tests and 3 browser tests pass, and documented that live Supabase, provider, Lighthouse-before, and production migration verification remain explicit limitations.

### 60-second technical walkthrough

The request flow is Next.js route handlers over Supabase repositories. The previous heartbeat path found a session, read the day, calculated elapsed time in TypeScript, and then updated two tables separately. The new RPC takes verified student/session/assignment IDs plus server time and policy values, obtains a transaction-scoped advisory lock, verifies ownership, calculates elapsed time, applies both caps, advances the watermark, and upserts the day atomically. The route remains thin and typed. Tests use injected repositories and fake services, while browser tests only validate public pages.

### Likely interview questions

**Q: What was the biggest issue?**  
A: The heartbeat read-modify-write sequence was vulnerable to stale concurrent writes. The RPC closes that race and keeps the server as the elapsed-time authority.

**Q: How did you prove the fix?**  
A: Unit tests verify RPC delegation and retake-limit propagation. The RPC itself was migration-reviewed but live PostgreSQL execution was not possible without an approved test database.

**Q: Did you claim a performance improvement?**  
A: No. The local route benchmark showed changes within noise and did not measure the database improvement. The final report distinguishes measured from unavailable evidence.

**Q: How did you handle external providers in tests?**  
A: I mocked repositories/services and tested DTO, metrics, configuration, and domain behavior. No paid Groq or Gemini request was made.

**Q: What would you do before production?**  
A: Apply 0007 to an approved staging database, run concurrent heartbeat tests, verify RLS and RPC grants, run live provider tests with staging keys, add rate limiting/observability, and perform a Next major-version security upgrade.

---

## 14. Optimisation Phase 2 — Verification and Reliability Continuation

### 14.1 Scope and method

This phase started by re-reading the existing implementation and reports, then inspecting:

- `0007_atomic_heartbeat_engine.sql`
- `StudentService.recordHeartbeat()`
- `SessionRepository.recordPracticeHeartbeat()`
- streak history retrieval
- assignment distribution
- AI failover and timeout signals

No live database, staging Supabase project, Docker daemon, `psql`, Supabase CLI, or paid provider credentials were available. No migration or external provider request was made.

### 14.2 Heartbeat migration review

The migration was reviewed for:

- Per-student transaction advisory locking
- Session ownership
- Assignment/session mismatch
- Assignment-distribution ownership
- First-heartbeat retake limits
- Server elapsed-time calculation
- Per-beat and daily caps
- Monotonic watermark advancement
- Ended-session rejection
- RPC least privilege

Corrections implemented in migration `0007`:

- Formal first heartbeats now verify `student_assignments` ownership.
- Existing sessions now reject an assignment-ID mismatch.
- Ended sessions now reject further heartbeat writes.
- The watermark is advanced with `greatest(existing watermark, server now)`, so clock rollback cannot move it backward.
- Session and daily writes remain in the RPC transaction under a per-student advisory lock.

These changes are source-verified but **not PostgreSQL-live-verified**.

### 14.3 Genuine reliability findings

#### Streak history truncation

The streak repository previously requested a fixed maximum of 400 practice-day rows. This could omit qualifying days beyond 400 and undercount the longest streak.

**Fix:**

- `SessionRepository.getDailyHistory()` now accepts an optional limit.
- The streak summary call supplies no limit.
- The full history is available to the current/longest streak calculation.

This is a correctness improvement, not a measured latency improvement.

#### AI timeout signal reuse

The previous combined timeout signal could remain aborted after Groq timeout and be reused for Gemini, preventing a fallback attempt.

**Fix:**

- Groq receives one 25-second combined timeout/cancellation signal.
- Gemini receives a separate fresh 25-second timeout/cancellation signal.
- A browser cancellation prevents Gemini fallback.
- A Groq timeout or provider error before any token falls back to Gemini.

#### Assignment ownership

A student could submit an arbitrary formal assignment ID without a matching distribution row.

**Fix:**

- `StudentService` now verifies `student_assignments` before formal coaching/attempt use.
- The heartbeat RPC independently verifies assignment distribution on a first heartbeat.
- Repository and route error mapping surface assignment mismatch as forbidden.

### 14.4 In-process benchmarks

All benchmarks below ran with Vitest 2.1.9 on the local macOS/Node environment. They benchmark application/service work and mock repositories. They do not represent database, network, or live provider latency.

| Workflow | Concurrency/size | Mean | p99 | Throughput |
|---|---:|---:|---:|---:|
| Streak calculation | 400 rows | 0.5032 ms | 0.5665 ms | 1987.41 ops/s |
| Streak calculation | 401 rows | 0.5547 ms | 1.0512 ms | 1802.63 ops/s |
| Heartbeat RPC delegation | 1 request | 0.0007 ms | 0.0009 ms | 1,390,651.94 ops/s |
| Heartbeat RPC delegation | 50 concurrent calls | 0.0348 ms | 0.0735 ms | 28,715.86 ops/s |
| Assignment distribution | 300 students | 0.0114 ms | 0.0170 ms | 87,526.83 ops/s |
| Assignment distribution | 3000 students | 0.1012 ms | 0.1541 ms | 9,876.80 ops/s |
| AI metric calculation | 1 transcript | 0.0044 ms | 0.0053 ms | 224,837.71 ops/s |

Vitest benchmark output does not provide measured p50/p95 values, so no p50/p95 values are reported.

#### Valid before/after comparison

There is no valid live database before/after comparison for the heartbeat migration.

The in-process measurements compare:

- The 400-row streak path with the 401-row path. The extra row increased mean from 0.5032 ms to 0.5547 ms and p99 from 0.5665 ms to 1.0512 ms.
- 300 versus 3000 mock assignment recipients. This does not measure database insertion latency.

No percentage improvement is claimed for these microbenchmarks.

### 14.5 Test verification

Final unit results:

- 6 test files
- 31 tests passed
- 0 failed
- 0 skipped

Final browser results:

- 3 Playwright Chromium tests passed
- 0 failed
- 0 skipped

Final quality gate:

- `npm run typecheck`: passed after production build generated route types
- `npm run lint`: passed
- `npm run build`: passed
- `npm run test:coverage`: 45.18% statements, 72.57% branches, 41.52% functions, 45.18% lines across included backend modules

### 14.6 Remaining live verification

Still required:

- Apply migration `0007` to an isolated local/staging PostgreSQL database.
- Run concurrent same-session heartbeat requests and verify one credit per watermark interval.
- Test duplicate heartbeat requests.
- Test future clock, backward clock, daily cap, ownership mismatch, and ended-session cases.
- Run `EXPLAIN ANALYZE` for heartbeat RPC, streak history, and metrics view.
- Run a controlled k6 load test against staging once credentials/data are isolated.
- Run controlled staging provider failover tests without unnecessary paid volume.
- Measure real AI time-to-first-token and total response time.
- Upgrade Next.js/framework dependencies only after compatibility planning.

### 14.7 Phase 2 files changed

- `supabase/migrations/0007_atomic_heartbeat_engine.sql`
- `src/backend/session/session.repository.ts`
- `src/backend/assignment/assignment.repository.ts`
- `src/backend/student/student.service.ts`
- `src/backend/ai/ai-coach.service.ts`
- `tests/student.service.test.ts`
- `tests/ai-coach.test.ts`
- `tests/heartbeat-migration.test.ts`
- `tests/performance.bench.ts`
- `ENGINEERING_PERFORMANCE_REPORT.md`
- `PROJECT_SPEC.md`

---

## 15. Local PostgreSQL Verification and Benchmark Phase

### 15.1 Local environment

- OS: macOS 26.6.2
- CPU: Apple M3
- Physical/logical CPU count: 8
- Memory: 16 GiB
- Docker Engine: 28.5.1
- Supabase CLI: 3.2.0
- Local PostgreSQL: PostgreSQL 17.12
- Node.js: v26.3.1
- npm: 11.16.0
- Benchmark pool: `pg` direct TCP client
- Local database endpoint: `127.0.0.1:54322`

No production database or production credentials were used.

### 15.2 Setup and migration status

Docker Desktop was initially stopped. Docker Desktop was started locally, and the Supabase CLI was installed. The local stack was initialized with `supabase init` and started with `supabase start`.

The migration set was applied by the local Supabase stack in this order:

1. `0001_initial_schema`
2. `0002_instructor_ecosystem`
3. `0003_student_session_engine`
4. `0004_ai_evaluations`
5. `0005_atomic_attempt_guardrail`
6. `0006_whitelist_role`
7. `0007_atomic_heartbeat_engine`

Verified public objects include:

- Required base tables and views
- `record_practice_heartbeat`
- `record_coaching_attempt`
- Speaking-session primary, foreign-key, attempt-uniqueness, and nonnegative-second constraints
- Practice-session unique `(student_id, session_date)` constraint
- Student-assignment unique `(assignment_id, student_id)` constraint
- Student/assignment/session indexes

Synthetic seed contents:

- 300 synthetic students
- 10 synthetic assignments
- 3000 synthetic assignment distributions
- 400 qualifying practice-day rows for synthetic student 300

### 15.3 Reproducible setup commands

```bash
open -a Docker
brew install supabase/tap/supabase
supabase init
supabase start
npm install
npm run db:seed
npm run db:verify
```

Database scripts:

```bash
npm run db:start
npm run db:reset
npm run db:seed
npm run db:verify
npm run db:stop
```

The local database is reset and seeded only with synthetic `@local.test` identities.

### 15.4 Heartbeat correctness results

All assertions passed on PostgreSQL 17.12:

| Test | Expected | Actual | Result |
|---|---|---|---|
| First heartbeat | new session, 0 credited | new session, 0 credited | PASS |
| 30-second heartbeat | 30 credited | 30 credited | PASS |
| Duplicate timestamp | 0 additional credit | 0 additional credit | PASS |
| 100 sequential beats | session/daily <= 1800 seconds | session/daily = 1800 seconds | PASS |
| Backward clock | 0 credit and no watermark movement | 0 credit | PASS |
| Ended session | `SESSION_ENDED` | `SESSION_ENDED` | PASS |
| Unassigned assignment | assignment or ownership rejection | `ASSIGNMENT_NOT_ASSIGNED` | PASS |
| 100 simultaneous requests for one student | 100 successes, session/daily <= 60 | 100 successes, session/daily = 60 | PASS |

The 100-simultaneous test initially failed because the benchmark pool was configured above the local PostgreSQL connection limit. The harness was corrected to pool 50 clients; the rerun passed all 100 queued operations without a database error.

### 15.5 Benchmark methodology

- Direct PostgreSQL RPC/application-equivalent round trips
- Concurrency: 1, 10, 25, 50, 100
- Repetitions: 3 per concurrency level
- Reported values: median of the three repetition medians
- PostgreSQL Pool maximum: 50 concurrent client connections
- Heartbeat old implementation: application-equivalent multi-query Node/`pg` sequence
- Heartbeat new implementation: `record_practice_heartbeat` RPC
- Streak operation: ordered `practice_sessions` read for synthetic student 300
- Metrics operation: `student_compliance_metrics` view ordered by name
- Assignment distribution: local transaction insert/insert/rollback for 300 synthetic students
- AI: no provider call; no key was detected in the benchmark process

The assignment-distribution benchmark measures direct SQL transaction time, not HTTP route/controller latency.

### 15.6 Heartbeat before-and-after

| Concurrency | Old average | New average | Latency improvement | Old throughput | New throughput | Throughput improvement | Old errors | New errors |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | 0.862 ms | 0.364 ms | 57.71% | 1156.40 req/s | 2727.27 req/s | 135.84% | 0 | 0 |
| 10 | 2.749 ms | 1.157 ms | 57.93% | 3358.01 req/s | 6884.88 req/s | 105.03% | 0 | 0 |
| 25 | 4.650 ms | 2.234 ms | 51.95% | 5100.00 req/s | 8369.60 req/s | 64.11% | 0 | 0 |
| 50 | 7.767 ms | 3.371 ms | 56.60% | 5872.19 req/s | 11665.77 req/s | 98.66% | 0 | 0 |
| 100 | 14.890 ms | 6.299 ms | 57.70% | 4915.34 req/s | 11207.20 req/s | 128.00% | 0 | 0 |

These improvements are for direct database/application-equivalent operations on the local machine. The old implementation is not the exact historical HTTP round trip sequence, but it faithfully reproduces its read-update-write operations.

### 15.7 Streak retrieval benchmark

| Concurrency | Median average | p50 | p95 | p99 | Throughput | Failed |
|---:|---:|---:|---:|---:|---:|---:|
| 1 | 0.536 ms | 0.536 ms | 0.536 ms | 0.536 ms | 1861.62 req/s | 0 |
| 10 | 1.751 ms | 1.659 ms | 2.670 ms | 2.670 ms | 3724.51 req/s | 0 |
| 25 | 3.437 ms | 3.443 ms | 5.547 ms | 5.749 ms | 4321.55 req/s | 0 |
| 50 | 8.035 ms | 8.046 ms | 12.999 ms | 13.456 ms | 3706.41 req/s | 0 |
| 100 | 12.331 ms | 12.648 ms | 21.322 ms | 22.044 ms | 4482.04 req/s | 0 |

Fixture correctness: 400 rows, 400 qualifying rows, and a 400-day streak at the benchmark date.

### 15.8 Instructor metrics benchmark

| Concurrency | Median average | p50 | p95 | p99 | Throughput | Failed |
|---:|---:|---:|---:|---:|---:|---:|
| 1 | 1.043 ms | 1.043 ms | 1.043 ms | 1.043 ms | 957.59 req/s | 0 |
| 10 | 3.751 ms | 3.787 ms | 4.593 ms | 4.593 ms | 2172.56 req/s | 0 |
| 25 | 6.431 ms | 6.442 ms | 8.865 ms | 9.073 ms | 2747.52 req/s | 0 |
| 50 | 12.029 ms | 12.130 ms | 17.388 ms | 17.656 ms | 2826.02 req/s | 0 |
| 100 | 18.482 ms | 18.841 ms | 28.612 ms | 29.454 ms | 3359.09 req/s | 0 |

### 15.9 Assignment distribution benchmark

Direct SQL transaction with one synthetic assignment and 300 synthetic student distributions, rolled back after measurement.

| Concurrency | Median average | p50 | p95 | p99 | Throughput | Failed |
|---:|---:|---:|---:|---:|---:|---:|
| 1 | 3.766 ms | 3.766 ms | 3.766 ms | 3.766 ms | 265.40 req/s | 0 |
| 10 | 13.314 ms | 14.112 ms | 15.152 ms | 15.152 ms | 659.31 req/s | 0 |
| 25 | 30.969 ms | 33.639 ms | 39.725 ms | 39.729 ms | 629.01 req/s | 0 |
| 50 | 58.038 ms | 61.610 ms | 79.428 ms | 79.596 ms | 627.84 req/s | 0 |
| 100 | 130.447 ms | 140.247 ms | 187.009 ms | 187.684 ms | 531.50 req/s | 0 |

### 15.10 Query execution time

`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` results:

- Heartbeat RPC: 0.212 ms
- Streak history: 0.081 ms
- Compliance metrics view: 6.567 ms

These are database execution plans for synthetic local data and are not HTTP/whole-request latency.

### 15.11 AI coaching benchmark

No Groq or Gemini provider key was detected in the local benchmark process. Therefore:

- Time-to-first-token: NOT MEASURED
- Total provider response time: NOT MEASURED
- Timeout rate: NOT MEASURED
- Provider fallback rate: NOT MEASURED
- Mock timeout/fallback/cancellation tests remain unit-tested

No paid API call was made.

### 15.12 Full verification results

- Unit Vitest: 31/31 passed
- Coverage: 45.18% statements, 72.57% branches, 41.52% functions, 45.18% lines
- Playwright: 3/3 passed on run 1; 3/3 passed on run 2; both exit 0
- TypeScript: exit 0
- ESLint: exit 0
- Production build: exit 0
- Local PostgreSQL verification: 8/8 assertions passed

The previous E2E silent rerun discrepancy was reproducible infrastructure state: a rerun previously had no managed web server. Playwright now starts `npm run dev -- --hostname 127.0.0.1` automatically and reuses an existing server. Two repeated final runs passed.

### 15.13 Remaining limitations

- No live HTTP load-test harness was used; benchmarks are direct `pg`/SQL and application-equivalent heartbeat operations.
- The old heartbeat comparison does not reproduce historical Next.js/Supabase network round trips exactly.
- AI provider timing and fallback remain unmeasured.
- No staging Supabase Auth session was used for HTTP route authorization.
- The assignment-distribution benchmark uses a rolled-back transaction and is not a full HTTP route benchmark.
- No production migration or production data was touched.

### 15.14 Resume-ready local database achievements

- Applied all seven SpeakCraft migrations to a local Supabase/PostgreSQL 17 environment and added a synthetic, repeatable 300-user seed.
- Proved the atomic heartbeat RPC across 8 correctness scenarios, including 100 simultaneous requests for one student, backward clocks, ended sessions, assignment ownership, and 1800-second daily limits.
- Measured median RPC latency improvements of 51.95%-57.93% and throughput improvements of 64.11%-135.84% across 1-to-100-user concurrency compared with an application-equivalent old round-trip implementation.
- Benchmarked streak retrieval, compliance metrics, and assignment distribution at 1, 10, 25, 50, and 100 concurrent requests on isolated local data.
- Removed Playwright's manual-server dependency by adding managed web-server startup and verified two consecutive E2E runs with exit 0 and 3/3 tests passing.

## 16. End-to-End API Load Test (November 2026)

This phase measured the local Next.js HTTP routes after the database-level atomic-heartbeat work. It does not treat the PostgreSQL improvement in Section 15 as an HTTP performance improvement.

### 16.1 Environment and safety

| Component | Test environment |
|---|---|
| Machine | macOS 26.6.2, Apple M3, 8 cores, 16 GiB RAM |
| Docker | 28.5.1 |
| Node.js | 26.3.1 |
| Next.js | 14.2.35 |
| Supabase CLI | 3.2.0 |
| PostgreSQL | 17.12, local Supabase |
| k6 | 2.4.0 |
| Application / Supabase API | `http://127.0.0.1:3100` / `http://127.0.0.1:54321` |

The application and database ran locally. The runner obtains Supabase settings from the local CLI status output and rejects non-loopback URLs; it does not use the non-loopback Supabase values in `.env.local`. The local service-role key is used only by the local app/fixture setup, while k6 receives only the local public anon key. Authentication cookies are held in memory and omitted from saved summaries. No production service or data was accessed.

### 16.2 Routes and test data

The route handlers, authentication checks, request schemas, and database calls were inspected before constructing requests. Measured endpoints:

| Operation | Route | Authentication |
|---|---|---|
| Student heartbeat | `POST /api/student/heartbeat` | Synthetic signed-in student |
| Student streak | `GET /api/student/streak` | Synthetic signed-in student |
| Instructor metrics | `GET /api/instructor/metrics` | Synthetic signed-in instructor |
| Assignment distribution | `POST /api/instructor/create-assignment` | Synthetic signed-in instructor |

Signup and roster upload were not load-tested because they mutate identity/allowlist state. Student assignments were inspected but were outside this benchmark matrix. AI coaching was not called; see Section 16.7.

The fixture contained 300 synthetic students, 10 assignments, 3,000 baseline distributions, and 400 streak-history rows, plus one reusable synthetic instructor. No account was created per request. Authentication/session acquisition was outside the timed interval, but the route's own user authentication and profile lookup were included. Heartbeat and assignment writes were checked in PostgreSQL and temporary rows were removed after verification.

### 16.3 Method and correctness checks

- One warm-up request was sent to each measured endpoint.
- Each endpoint was run at 1, 10, 25, 50, and 100 VUs, with three repetitions per VU level: 60 benchmark runs and 2,232 requests total (558 per endpoint).
- VUs ramped up over two seconds and issued one request each in a bounded wave. There was no unbounded or sustained-duration load.
- For each row below, request/success/failure counts are totals across the three repetitions. Latencies and wave throughput are the median of the three per-run values. Each run's p50/p95/p99 was calculated first, then the median of those values is reported.
- Wave throughput is requests divided by the elapsed interval from the first request start to the last response completion; it is not a sustainable-capacity or long-running throughput estimate.
- Percentiles at 1 VU are based on one sample per repetition and should not be treated as statistically stable tail estimates. Higher-VU results also use a small number of samples per repetition.
- The k6 checks validated HTTP status and operation-specific response shape. For streak, the response included the expected 400 history entries and 600-second daily goal.

Heartbeat database checks:

| Check | Expected | Actual |
|---|---|---|
| Full API matrix | Each of 558 successful benchmark heartbeats credits its seeded 60-second interval exactly once | 558/558 session/day records matched; temporary rows removed |
| 25 simultaneous requests for one student | No more practice credit than elapsed wall time | 25/25 expected API responses; 3 seconds elapsed and 3 seconds persisted to session/day totals |
| Daily cap | 1,740 seconds already credited plus a heartbeat reaches, but does not exceed, 1,800 seconds | Capped at 1,800 seconds |
| Duplicate heartbeat | Replaying the same watermark adds no duplicate credit | 0 additional seconds |
| Ended session | No further credit | Rejected; persisted total unchanged |
| Assignment ownership | A student cannot heartbeat an unowned assignment | Rejected; no session was created |
| Backward clock (database/RPC verification in the preceding phase) | A lower timestamp cannot move the watermark backward or subtract credit | Watermark did not regress; no negative credit |
| Assignment distribution | Each successful create distributes to the fixture's 300 students | Database row count verified for every run; temporary assignment/distribution rows removed |

The cap, duplicate, ended-session, and ownership cases were rerun by the final smoke harness. The backward-clock case is from the preceding database/RPC verification, not this HTTP harness. The 25-request same-student burst completed with all 25 responses passing and database state rechecked.

### 16.4 API measurements

All rows had zero failed requests, zero HTTP errors, and zero timeouts. Request counts are `total / successful / failed` across three repetitions.

**Student heartbeat**

| VUs | Requests / success / failed | Avg ms | p50 ms | p95 ms | p99 ms | Wave req/s | HTTP errors / timeouts |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | 3 / 3 / 0 | 40.41 | 40.41 | 40.41 | 40.41 | 24.74 | 0% / 0 |
| 10 | 30 / 30 / 0 | 46.22 | 46.92 | 49.76 | 50.09 | 196.43 | 0% / 0 |
| 25 | 75 / 75 / 0 | 76.69 | 77.94 | 90.80 | 91.49 | 267.90 | 0% / 0 |
| 50 | 150 / 150 / 0 | 99.17 | 106.84 | 130.42 | 131.93 | 370.76 | 0% / 0 |
| 100 | 300 / 300 / 0 | 152.34 | 146.24 | 196.10 | 198.86 | 468.67 | 0% / 0 |

**Student streak**

| VUs | Requests / success / failed | Avg ms | p50 ms | p95 ms | p99 ms | Wave req/s | HTTP errors / timeouts |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | 3 / 3 / 0 | 29.75 | 29.75 | 29.75 | 29.75 | 33.62 | 0% / 0 |
| 10 | 30 / 30 / 0 | 88.43 | 88.11 | 95.28 | 95.73 | 103.53 | 0% / 0 |
| 25 | 75 / 75 / 0 | 68.34 | 68.27 | 91.16 | 92.50 | 265.34 | 0% / 0 |
| 50 | 150 / 150 / 0 | 111.77 | 112.99 | 162.17 | 166.93 | 296.47 | 0% / 0 |
| 100 | 300 / 300 / 0 | 175.40 | 171.59 | 282.82 | 287.83 | 337.71 | 0% / 0 |

**Instructor metrics**

| VUs | Requests / success / failed | Avg ms | p50 ms | p95 ms | p99 ms | Wave req/s | HTTP errors / timeouts |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | 3 / 3 / 0 | 48.39 | 48.39 | 48.39 | 48.39 | 20.66 | 0% / 0 |
| 10 | 30 / 30 / 0 | 76.11 | 75.78 | 82.63 | 82.94 | 118.84 | 0% / 0 |
| 25 | 75 / 75 / 0 | 78.13 | 79.88 | 85.23 | 87.70 | 270.05 | 0% / 0 |
| 50 | 150 / 150 / 0 | 113.18 | 110.52 | 143.96 | 144.59 | 332.17 | 0% / 0 |
| 100 | 300 / 300 / 0 | 182.90 | 175.48 | 238.60 | 240.04 | 400.00 | 0% / 0 |

**Assignment distribution**

| VUs | Requests / success / failed | Avg ms | p50 ms | p95 ms | p99 ms | Wave req/s | HTTP errors / timeouts |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | 3 / 3 / 0 | 74.97 | 74.97 | 74.97 | 74.97 | 13.34 | 0% / 0 |
| 10 | 30 / 30 / 0 | 251.82 | 254.75 | 256.31 | 256.41 | 38.75 | 0% / 0 |
| 25 | 75 / 75 / 0 | 205.14 | 210.28 | 222.92 | 222.96 | 110.65 | 0% / 0 |
| 50 | 150 / 150 / 0 | 685.66 | 718.26 | 800.14 | 805.22 | 61.77 | 0% / 0 |
| 100 | 300 / 300 / 0 | 618.71 | 636.50 | 818.89 | 824.04 | 119.65 | 0% / 0 |

The non-monotonic assignment results at 25/50/100 VUs and other variation across repetitions are reported as measured, not smoothed or extrapolated. Three short repetitions are not enough to establish a stable capacity curve.

### 16.5 Comparison with PostgreSQL results

At 100 concurrent calls, the existing direct database comparison reported:

| Measurement layer | Operation | Avg ms | p95 ms | p99 ms | Throughput req/s |
|---|---|---:|---:|---:|---:|
| PostgreSQL direct | Previous application-equivalent heartbeat flow | 14.890 | 19.876 | 20.253 | 4,915.34 |
| PostgreSQL direct | Atomic heartbeat RPC | 6.299 | 8.764 | 8.796 | 11,207.20 |
| HTTP API | `POST /api/student/heartbeat` | 152.34 | 196.10 | 198.86 | 468.67 |

The direct database measurements show a 57.70% average-latency reduction and a 128% throughput increase for the database operation. These percentages do **not** apply to the API. The API request includes Supabase Auth user validation, profile/role lookup, Next.js route processing, PostgREST/Kong and local network hops, JSON handling, and the RPC. The database benchmark measures a different span and uses a different throughput calculation, so the two throughput values are not directly comparable. API-side per-query execution timing was not instrumented; previously measured direct query timings remain in Section 15.

No old HTTP API baseline or Git history was available in this workspace (it is not a Git repository), so an equivalent old-versus-new API comparison and API latency/throughput improvement percentage cannot be calculated. No percentage improvement is claimed for the API.

### 16.6 Verification, artifacts, and failures

- Full k6 matrix: 60 endpoint/concurrency/repetition runs; 2,232/2,232 successful requests; 0 HTTP failures and 0 timeouts.
- Final smoke after strengthening the streak assertion: 4/4 warm-up checks, 4/4 cap/duplicate/ended/ownership checks, and 25/25 same-student concurrent heartbeat checks passed.
- Vitest: 31/31 passed. TypeScript check, ESLint, and production build exited 0 in the completed verification run; the final smoke also completed a production build and API runtime checks successfully.
- Playwright was not rerun in this API load-test phase. The preceding phase recorded two 3/3 passing runs; k6 exercised the API routes directly.
- Initial, unmeasured harness attempts exposed a local seeded-Auth token-field incompatibility and k6 runtime assumptions (URL/VU identifier handling). The fixture/harness were corrected before the final matrix; those attempts are not included in the benchmark numbers.
- Verification after the final run found no remaining load-test assignment/session/practice rows. The Next.js test server was stopped; local PostgreSQL remained healthy.
- No request summary contains authentication setup data or cookies.

Files created for this API load-test phase: `load-tests/api.js`, `load-tests/run-local.mjs`, `load-tests/setup.sql`, and `load-tests/README.md`. Benchmark artifacts were written under `load-tests/results/`. Files modified: `package.json` (load-test commands), `supabase/seed.sql` (local synthetic Auth compatibility), `PROJECT_SPEC.md` (local setup and scripts), and this report. No API route implementation was changed.

Raw k6 output and individual run summaries are saved under [`load-tests/results/run-20261121191857685-dc28/`](./load-tests/results/run-20261121191857685-dc28/). The aggregate is [`api-load-results.json`](./load-tests/results/run-20261121191857685-dc28/api-load-results.json). The final smoke output is under [`load-tests/results/run-20261121193911900-f716/`](./load-tests/results/run-20261121193911900-f716/).

Reproduce on the same local-only synthetic setup:

```bash
brew install k6
npm run db:start
npm run db:seed
npm run loadtest:setup
npm run loadtest:smoke
npm run loadtest:api
npm run loadtest:cleanup
```

### 16.7 AI coaching and remaining limits

AI coaching was not benchmarked. Calling `/api/coach/analyze` sends prompt content to external providers and can incur cost; no provider-isolated local endpoint or authorized spend budget was established. Time to first token, total response time, timeout rate, and provider fallback rate are therefore **not measured**. Existing mock-based timeout/fallback tests are not provider performance measurements.

These are local measurements on one machine and a synthetic dataset. They are not staging or production SLO evidence. The bounded one-request-per-VU waves do not model sustained workloads; p95/p99 estimates, particularly at low VUs, have limited sample size. Per-request SQL timings and a prior HTTP implementation baseline are unavailable. The final script validates the 400-entry streak history and daily goal, but this run does not establish a broad streak-consistency benchmark across arbitrary student histories.

### 16.8 Resume-ready API load-testing achievements

- Built a loopback-only k6 harness with reusable Supabase-authenticated synthetic accounts and safe summary handling; benchmarked heartbeat, streak, instructor metrics, and assignment distribution across 1-100 VUs.
- Completed 60 bounded API runs and verified 2,232/2,232 correct responses with zero HTTP failures or timeouts; retained raw NDJSON and per-run summaries.
- Verified 558 heartbeat writes against PostgreSQL and exercised same-student concurrency, daily cap, duplicate, ended-session, and assignment-ownership cases without over-credit; retained the separate prior-phase database/RPC backward-clock verification.
- Measured 100-VU API p95 latencies of 196.10 ms (heartbeat), 282.82 ms (streak), 238.60 ms (metrics), and 818.89 ms (assignment distribution), while explicitly separating HTTP results from the 57.70% database-level latency reduction.
