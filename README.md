# SpeakCraft — Phase 1

Asynchronous public-speaking practice platform for a 300-student cohort.
**Stack:** Next.js 14 (App Router, TypeScript) · Tailwind CSS · Supabase (PostgreSQL + Auth).

Phase 1 delivers the database schema, the whitelist-gated auth engine, the
layered backend for the user-account lifecycle, and the light-themed login UI.

## Design contract

- Brand primary: **`#004CE5`** (`brand-primary` in Tailwind) — the only accent.
- Surfaces: crisp white (`#FFFFFF`) with off-white / light-gray containers.

## Setup

```bash
npm install
cp .env.local.example .env.local   # fill in from Supabase project settings
```

Apply the migration to your Supabase project (SQL editor or CLI):

```
supabase/migrations/0001_initial_schema.sql
```

Then seed the whitelist so accounts can be created:

```sql
insert into public.allowed_emails (email) values ('student@campus.edu');
```

```bash
npm run dev        # http://localhost:3000  →  /login
npm run typecheck  # strict tsc, no emit
npm run build      # production build
```

## Architecture — layered backend (`src/backend/user/`)

Request → **Controller** → **DTO (validate)** → **Service (business logic)** → **Repository (data access)** → Supabase.

| Layer | File | Responsibility |
|-------|------|----------------|
| DTO | `user.dto.ts` | Validate & normalise data at the API boundary. |
| Entity | `user.entity.ts` | Exact shape of Supabase rows (persistence truth). |
| Repository | `user.repository.ts` | Isolated Supabase queries (service-role client). |
| Service | `auth.service.ts` | **Whitelist gate** + account lifecycle orchestration. |
| Controller | `src/app/api/auth/signup/route.ts` | HTTP handler; maps outcomes to status codes. |

### `POST /api/auth/signup` status contract

| Status | Meaning |
|--------|---------|
| `201` | Account created (`{ user }`). |
| `400` | Malformed JSON / validation failure. |
| `403` | Email not on the campus whitelist. |
| `409` | Email already registered. |
| `502` | Upstream auth-provider error. |
| `500` | Profile persistence / unexpected error. |

The whitelist check runs **before** any write. If the auth identity is created
but the profile insert fails, the service compensates by deleting the identity
so no orphaned auth user is left behind.

## Phase 2 — Instructor ecosystem

Migration `supabase/migrations/0002_instructor_ecosystem.sql` adds:

- `student_assignments` — a distribution fan-out (one row per assignment per
  student) with a lifecycle `status`, enabling per-student compliance tracking.
- `student_compliance_metrics` — a read-model view aggregating assignments
  assigned/completed and total practice time per student (aggregated in separate
  subqueries to avoid cartesian SUM inflation across the two child tables).

### Layered backend (`src/backend/`)

| Layer | File | Responsibility |
|-------|------|----------------|
| DTO | `assignment/assignment.dto.ts`, `roster/roster.dto.ts` | Validate create-assignment payloads; parse CSV / email arrays into a clean whitelist. |
| Entity | `assignment/assignment.entity.ts` | Row shapes for assignments, distributions, and the metrics view. |
| Repository | `assignment/assignment.repository.ts` (+ `user.repository.ts` additions) | Publish assignments, fan-out distribution, read metrics, bulk-insert whitelist. |
| Service | `instructor/instructor.service.ts` | Roster batch ingest + the **assignment-blast distribution algorithm**. |
| Controller | `src/app/api/instructor/*` | Instructor-gated HTTP handlers. |

### Instructor endpoints (all require an `instructor` session)

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/instructor/upload-roster` | POST | Ingest a CSV / email array into `allowed_emails`. |
| `/api/instructor/create-assignment` | POST | Create an assignment and blast it to the whole cohort. |
| `/api/instructor/metrics` | GET | Serve the per-student compliance report. |

Authorization runs through `requireInstructor()`
([src/backend/auth/authorization.ts](src/backend/auth/authorization.ts)), which
validates the session via `auth.getUser()` and checks the profile role.

### UI

`/instructor` ([src/app/instructor/](src/app/instructor/)) — drag-and-drop
roster uploader, assignment composer (title / format select / prompt), and a
live compliance tracker table, all in the `#004CE5` light theme.

## Phase 3 — Student experience & heartbeat engine

Migration `supabase/migrations/0003_student_session_engine.sql` adds:

- `speaking_sessions` — one row per practice session / assignment attempt, with a
  **client-generated id** (idempotent first heartbeat) and a server-authoritative
  `last_heartbeat_at` watermark. Also the attempt ledger for the retake guardrail.
- `practice_sessions` promoted to a **per-day accumulator** (unique per
  `(student, day)`); every heartbeat upserts the governed daily total that feeds
  both streaks and the Phase 2 compliance view.

Governance rules live in [practice-policy.ts](src/backend/student/practice-policy.ts):

| Rule | Value | Where enforced |
|------|-------|----------------|
| Accumulator goal | 10 min/day (cumulative) | streak calc in `student.service.ts` |
| Usage governor | 30 min/day ceiling | heartbeat crediting in `student.service.ts` |
| Heartbeat cadence | 30 s | client hook + response contract |
| Max credit / beat | 60 s (2 intervals) | caps runaway gaps from throttled tabs |
| Retake guardrail | 4 attempts/assignment | session creation in `student.service.ts` |

### Layers

| Layer | File | Responsibility |
|-------|------|----------------|
| DTO | `session/session.dto.ts`, `session/streak.dto.ts` | Heartbeat contract (no client-supplied duration) + streak projections. |
| Entity | `session/session.entity.ts` | Row shapes for sessions + the daily accumulator. |
| Repository | `session/session.repository.ts` | Session CRUD, attempt counts, daily upsert/aggregate, streak history. |
| Service | `student/student.service.ts` | Heartbeat accumulator engine, governor, guardrail, streak computation. |
| Controller | `src/app/api/student/*` | Student-gated handlers. |

### Student endpoints (all require a `student` session)

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/student/heartbeat` | POST | Credit governed practice time, server-computed from the watermark. |
| `/api/student/streak` | GET | Gamified streak summary. |
| `/api/student/assignments` | GET | Assignments enriched with attempt usage. |

**Security of the accumulator:** the heartbeat body carries only a session id (and
optional assignment id) — never a duration. The server credits
`min(elapsedSinceWatermark, perBeatCap, remainingDailyAllowance)` using its own
clock, so a client cannot inflate its total, dropped pings self-heal, and the
watermark always advances so idle gaps never accrue.

### UI

`/student` ([src/app/student/](src/app/student/)) — a responsive `#004CE5`
dashboard: the gamified streak block, instructor-assignment cards (with remaining
attempts), and a live practice console driven by the resilient
[useHeartbeat](src/app/student/_hooks/useHeartbeat.ts) 30-second engine.

## Phase 4 — Multi-LLM Voice Coach (Edge streaming)

Migration `supabase/migrations/0004_ai_evaluations.sql` adds the `evaluations`
table — **text only, never audio**: transcript, consolidated Sandwich-Method
feedback, a numeric delivery score, filler/word metrics, and which provider
(`groq` | `gemini`) served the stream.

### Layers (`src/backend/ai/`)

| Layer | File | Responsibility |
|-------|------|----------------|
| DTO | `evaluation.dto.ts` | Validate transcript + assignment id + attempt count. |
| Entity | `evaluation.entity.ts` | `evaluations` row shape. |
| Repository | `evaluation.repository.ts` | Edge-safe terminal persistence. |
| Service | `ai-coach.service.ts` | Prompt rules, **Groq→Gemini failover streaming**, scoring, persistence. |
| Controller | `src/app/api/coach/analyze/route.ts` | **Edge** route piping the live stream to the client. |

### How the core rules are satisfied

- **Audio storage safety** — the browser transcribes via the Web Speech API
  ([useSpeechRecognition](src/app/student/practice/_hooks/useSpeechRecognition.ts));
  only text is sent and stored. No `.wav`/`.mp3` ever touches the server or DB.
- **Vercel 10s timeout** — `/api/coach/analyze` sets `runtime = 'edge'` and
  streams a chunked `text/plain` body; the client reads it with a
  `ReadableStream` reader and animates tokens as they arrive.
- **Multi-LLM failover** — the service reads `GROQ_API_KEY` / `GEMINI_API_KEY`,
  streams from **Groq (Llama 3)** first, and on any Groq error *before the first
  token* (429, network, missing key) switches seamlessly to **Gemini** mid-request.
- **Indian-English persona** — the shared system prompt casts "Coach Anaya", a
  warm, low-anxiety Indian-English coach; recognition uses the `en-IN` locale.
- **Sandwich Method** — the system prompt enforces the exact three sections:
  **Praise → Constructive Critique → Motivation**.

### Env

Set `GROQ_API_KEY` and/or `GEMINI_API_KEY` (server-only). At least one is
required; provide both to exercise the failover.

### UI

`/student/practice` — capture workspace with live on-device transcription, a
primary "Stop & Get AI Coaching" trigger, and a container that streams the
coach's feedback token-by-token in the `#004CE5` light theme.

### Cross-phase integration (coaching counts as an attempt)

When `/student/practice` is opened for a formal assignment (`?assignmentId=…`):

- **Pre-stream guardrail** — the Edge route calls `assertAttemptAllowed` before
  opening the stream; an over-limit request returns `409` (surfaced on the page)
  instead of failing mid-stream.
- **On successful stream end** — the run is recorded as a formal attempt (an
  ended `speaking_sessions` row → counts toward the 4-attempt retake guardrail
  and the dashboard's "attempts left"), and the student's `student_assignments`
  row is flipped to `completed`, so the **instructor compliance tracker** reflects
  it. A run where both providers fail produces no feedback and therefore consumes
  no attempt.
- **Concurrency-safe (migration 0005)** — the attempt count + ceiling check +
  insert + completion run atomically inside the `record_coaching_attempt`
  Postgres function, serialized per (student, assignment) by a transaction-scoped
  advisory lock, with a `UNIQUE(assignment_id, student_id, attempt_number)`
  backstop. Concurrent coaching requests can never produce an over-limit attempt;
  a lost race surfaces as a clean `RetakeLimitExceededError` (409-class), not a 5th row.

## Security notes

- `SUPABASE_SERVICE_ROLE_KEY` is server-only (no `NEXT_PUBLIC_` prefix); the
  admin/server clients and repositories are guarded with `import "server-only"`.
- Row Level Security is enabled on every table. `allowed_emails` has **no**
  client policies — only the server (service role) can read it.
- Every instructor mutation endpoint is gated by `requireInstructor()`; students
  and anonymous callers receive `403` / `401`.
