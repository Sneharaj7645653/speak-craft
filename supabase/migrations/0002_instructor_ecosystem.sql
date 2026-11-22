-- ═════════════════════════════════════════════════════════════════════════════
-- Migration:   0002_instructor_ecosystem
-- Project:     SpeakCraft — asynchronous public-speaking practice platform
-- Phase:       2 (Instructor Dashboard, Roster Ingestion, Assignment Blast)
-- Engine:      PostgreSQL (Supabase)
--
-- Architectural intent
-- --------------------
--   Phase 1 modelled `assignments` as a flat, cohort-wide table. Phase 2 adds a
--   real DISTRIBUTION fan-out so that publishing an assignment emits one
--   trackable record per student, which in turn powers the compliance tracker.
--
--     * `student_assignments`          — join/fan-out row: (assignment → student)
--                                         plus a lifecycle status for compliance.
--     * `student_compliance_metrics`   — read-model view aggregating, per
--                                         student, assignments assigned/completed
--                                         and total practice time. Consumed by
--                                         the instructor dashboard.
-- ═════════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────
-- ENUM: assignment lifecycle status (per student)
-- ─────────────────────────────────────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from pg_type where typname = 'assignment_status') then
    create type public.assignment_status as enum ('assigned', 'completed');
  end if;
end$$;

-- ═════════════════════════════════════════════════════════════════════════════
-- TABLE: student_assignments  (distribution fan-out)
-- One row per (assignment, student). Uniqueness prevents double-distribution.
-- ═════════════════════════════════════════════════════════════════════════════
create table if not exists public.student_assignments (
  id            uuid        primary key default gen_random_uuid(),
  assignment_id uuid        not null
                            references public.assignments (id) on delete cascade,
  student_id    uuid        not null
                            references public.users (id) on delete cascade,
  status        public.assignment_status not null default 'assigned',
  assigned_at   timestamptz not null default now(),
  completed_at  timestamptz,
  -- A student may receive a given assignment exactly once.
  constraint student_assignments_unique unique (assignment_id, student_id)
);

-- Hot query path: "all distributions for a student".
create index if not exists student_assignments_student_idx
  on public.student_assignments (student_id);

-- Hot query path: "all recipients of an assignment".
create index if not exists student_assignments_assignment_idx
  on public.student_assignments (assignment_id);

comment on table public.student_assignments is
  'Distribution fan-out: one row per assignment per student, with compliance status.';

-- ═════════════════════════════════════════════════════════════════════════════
-- VIEW: student_compliance_metrics  (read model for the compliance tracker)
--
-- Assignments and practice sessions are aggregated in SEPARATE subqueries before
-- being joined to `users`. Aggregating them in a single multi-join would produce
-- a cartesian product that inflates SUM(seconds_practiced) — the subquery
-- pattern below avoids that fan-out multiplication.
-- ═════════════════════════════════════════════════════════════════════════════
create or replace view public.student_compliance_metrics as
select
  u.id                                            as student_id,
  u.name                                          as name,
  u.email                                         as email,
  coalesce(a.assignments_assigned, 0)::int        as assignments_assigned,
  coalesce(a.assignments_completed, 0)::int       as assignments_completed,
  coalesce(p.total_seconds_practiced, 0)::bigint  as total_seconds_practiced,
  coalesce(p.total_sessions, 0)::int              as total_sessions
from public.users u
left join (
  select
    student_id,
    count(*)                                          as assignments_assigned,
    count(*) filter (where status = 'completed')      as assignments_completed
  from public.student_assignments
  group by student_id
) a on a.student_id = u.id
left join (
  select
    student_id,
    sum(seconds_practiced) as total_seconds_practiced,
    count(*)               as total_sessions
  from public.practice_sessions
  group by student_id
) p on p.student_id = u.id
where u.role = 'student';

comment on view public.student_compliance_metrics is
  'Per-student roll-up of assignment compliance and practice time. Read server-side.';

-- ═════════════════════════════════════════════════════════════════════════════
-- ROW LEVEL SECURITY — student_assignments
-- The backend writes via the service-role key (bypasses RLS). Students may read
-- and update ONLY their own distribution rows (e.g. to mark completion later).
-- ═════════════════════════════════════════════════════════════════════════════
alter table public.student_assignments enable row level security;

drop policy if exists "student_assignments_select_own" on public.student_assignments;
create policy "student_assignments_select_own"
  on public.student_assignments for select
  using (auth.uid() = student_id);

drop policy if exists "student_assignments_update_own" on public.student_assignments;
create policy "student_assignments_update_own"
  on public.student_assignments for update
  using (auth.uid() = student_id)
  with check (auth.uid() = student_id);
