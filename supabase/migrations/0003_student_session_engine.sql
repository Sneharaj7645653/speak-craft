-- ═════════════════════════════════════════════════════════════════════════════
-- Migration:   0003_student_session_engine
-- Project:     SpeakCraft — asynchronous public-speaking practice platform
-- Phase:       3 (Student Dashboard, Gamification, Heartbeat Accumulator Engine)
-- Engine:      PostgreSQL (Supabase)
--
-- Architectural intent
-- --------------------
--   * `speaking_sessions`  — one row per practice SESSION / assignment ATTEMPT.
--                            Carries the server-authoritative `last_heartbeat_at`
--                            watermark used to credit elapsed time securely, and
--                            doubles as the attempt ledger for the retake
--                            guardrail (3–4 attempts per formal assignment).
--   * `practice_sessions`  — promoted to a DAILY ACCUMULATOR: exactly one row per
--                            (student, day). Every heartbeat adds credited seconds
--                            here, capped at the daily governor. This single total
--                            powers both the streak engine and the Phase 2
--                            compliance view.
-- ═════════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────
-- ENUM: speaking-session lifecycle
-- ─────────────────────────────────────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from pg_type where typname = 'speaking_session_status') then
    create type public.speaking_session_status as enum ('active', 'ended');
  end if;
end$$;

-- ═════════════════════════════════════════════════════════════════════════════
-- TABLE: speaking_sessions  (session / attempt ledger)
--
-- `id` is CLIENT-GENERATED (a UUID minted when a speaking session opens) so that
-- the first heartbeat idempotently creates the row and retried heartbeats after a
-- network drop never create duplicates.
-- ═════════════════════════════════════════════════════════════════════════════
create table if not exists public.speaking_sessions (
  id                uuid        primary key,
  student_id        uuid        not null
                                references public.users (id) on delete cascade,
  -- NULL => free practice. Non-NULL => a formal attempt at an assignment.
  assignment_id     uuid        references public.assignments (id) on delete set null,
  -- 1-based attempt index for formal attempts; NULL for free practice.
  attempt_number    integer     check (attempt_number is null or attempt_number >= 1),
  seconds_accumulated integer   not null default 0 check (seconds_accumulated >= 0),
  status            public.speaking_session_status not null default 'active',
  started_at        timestamptz not null default now(),
  -- Server watermark: the instant of the last credited heartbeat.
  last_heartbeat_at timestamptz not null default now(),
  ended_at          timestamptz
);

create index if not exists speaking_sessions_student_idx
  on public.speaking_sessions (student_id);

-- Fast attempt counting for the retake guardrail.
create index if not exists speaking_sessions_assignment_student_idx
  on public.speaking_sessions (assignment_id, student_id);

comment on table public.speaking_sessions is
  'Practice sessions / assignment attempts. Holds the server heartbeat watermark and attempt ledger.';

-- ═════════════════════════════════════════════════════════════════════════════
-- PROMOTE practice_sessions to a per-day accumulator.
-- One row per (student, day) so heartbeats can UPSERT-accumulate into it.
-- (The Phase 1 table already has the (student_id, session_date) btree index.)
-- ═════════════════════════════════════════════════════════════════════════════
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'practice_sessions_student_date_unique'
  ) then
    alter table public.practice_sessions
      add constraint practice_sessions_student_date_unique
      unique (student_id, session_date);
  end if;
end$$;

comment on table public.practice_sessions is
  'Per-student per-day practice accumulator (one row per day). Governed to a daily ceiling by the service layer.';

-- ═════════════════════════════════════════════════════════════════════════════
-- ROW LEVEL SECURITY (defense-in-depth; the server writes via the service role).
-- ═════════════════════════════════════════════════════════════════════════════
alter table public.speaking_sessions enable row level security;

drop policy if exists "speaking_sessions_select_own" on public.speaking_sessions;
create policy "speaking_sessions_select_own"
  on public.speaking_sessions for select
  using (auth.uid() = student_id);

drop policy if exists "speaking_sessions_insert_own" on public.speaking_sessions;
create policy "speaking_sessions_insert_own"
  on public.speaking_sessions for insert
  with check (auth.uid() = student_id);

drop policy if exists "speaking_sessions_update_own" on public.speaking_sessions;
create policy "speaking_sessions_update_own"
  on public.speaking_sessions for update
  using (auth.uid() = student_id)
  with check (auth.uid() = student_id);

-- practice_sessions gains an update-own policy for the accumulator upsert path.
drop policy if exists "practice_sessions_update_own" on public.practice_sessions;
create policy "practice_sessions_update_own"
  on public.practice_sessions for update
  using (auth.uid() = student_id)
  with check (auth.uid() = student_id);
