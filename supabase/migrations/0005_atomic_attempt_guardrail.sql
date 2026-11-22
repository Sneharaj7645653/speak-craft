-- ═════════════════════════════════════════════════════════════════════════════
-- Migration:   0005_atomic_attempt_guardrail
-- Project:     SpeakCraft — asynchronous public-speaking practice platform
-- Phase:       4 (hardening — concurrency-safe retake guardrail)
-- Engine:      PostgreSQL (Supabase)
--
-- Problem
-- -------
--   The application-level "count attempts → insert attempt" sequence has a
--   check-then-act race: two concurrent coaching runs for the same
--   (student, assignment) could both read N attempts and both insert the
--   (N+1)th, exceeding the ceiling by one.
--
-- Fix
-- ---
--   1. A UNIQUE constraint on (assignment_id, student_id, attempt_number) makes
--      a duplicate attempt number physically impossible (NULLs are distinct, so
--      free-practice rows — assignment_id/attempt_number NULL — are unaffected).
--   2. record_coaching_attempt() performs count + ceiling-enforcement + insert +
--      completion INSIDE ONE TRANSACTION, serialized per (student, assignment)
--      by a transaction-scoped advisory lock. Concurrent callers for the same
--      pair run one-at-a-time, so the count is always accurate and the ceiling
--      is exact. The unique constraint remains as a backstop.
-- ═════════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Uniqueness backstop for formal attempts.
-- ─────────────────────────────────────────────────────────────────────────────
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'speaking_sessions_attempt_unique'
  ) then
    alter table public.speaking_sessions
      add constraint speaking_sessions_attempt_unique
      unique (assignment_id, student_id, attempt_number);
  end if;
end$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Atomic, concurrency-safe attempt recorder.
--
-- Returns the 1-based attempt number assigned to the run. Raises
-- 'RETAKE_LIMIT_EXCEEDED' (SQLSTATE P0001) when the ceiling is already reached.
-- Also flips the student's distribution to 'completed' (idempotently) in the
-- same transaction, so the attempt and the completion succeed or fail together.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.record_coaching_attempt(
  p_student_id    uuid,
  p_assignment_id uuid,
  p_max_attempts  integer,
  p_session_id    uuid,
  p_now           timestamptz
) returns integer
language plpgsql
-- Pin search_path so the function is not affected by the caller's settings.
set search_path = public
as $$
declare
  v_used    integer;
  v_attempt integer;
begin
  -- Serialize concurrent recorders for THIS (student, assignment) pair. The lock
  -- is held until the transaction commits/rolls back, so the count below cannot
  -- be observed stale by a racing caller for the same pair.
  perform pg_advisory_xact_lock(
    hashtextextended(p_student_id::text || ':' || p_assignment_id::text, 0)
  );

  select count(*) into v_used
  from public.speaking_sessions
  where student_id = p_student_id
    and assignment_id = p_assignment_id;

  if v_used >= p_max_attempts then
    raise exception 'RETAKE_LIMIT_EXCEEDED'
      using detail = format('used=%s max=%s', v_used, p_max_attempts);
  end if;

  v_attempt := v_used + 1;

  insert into public.speaking_sessions
    (id, student_id, assignment_id, attempt_number,
     seconds_accumulated, status, started_at, last_heartbeat_at, ended_at)
  values
    (p_session_id, p_student_id, p_assignment_id, v_attempt,
     0, 'ended', p_now, p_now, p_now);

  -- Reflect completion on the instructor-facing distribution row (idempotent).
  update public.student_assignments
    set status = 'completed', completed_at = p_now
    where student_id = p_student_id
      and assignment_id = p_assignment_id
      and status = 'assigned';

  return v_attempt;
end;
$$;

comment on function public.record_coaching_attempt is
  'Atomically records a one-shot coaching attempt (advisory-locked), enforces the retake ceiling, and marks the assignment completed. Returns the attempt number.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Least-privilege: only the server (service role) may invoke this. Never the
--    browser anon/authenticated roles — attempt recording is server-authoritative.
-- ─────────────────────────────────────────────────────────────────────────────
revoke all on function public.record_coaching_attempt(uuid, uuid, integer, uuid, timestamptz)
  from public;
revoke all on function public.record_coaching_attempt(uuid, uuid, integer, uuid, timestamptz)
  from anon, authenticated;
grant execute on function public.record_coaching_attempt(uuid, uuid, integer, uuid, timestamptz)
  to service_role;
