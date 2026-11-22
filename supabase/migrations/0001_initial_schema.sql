-- ═════════════════════════════════════════════════════════════════════════════
-- Migration:   0001_initial_schema
-- Project:     SpeakCraft — asynchronous public-speaking practice platform
-- Phase:       1 (Database, Auth Engine, Layered Backend)
-- Engine:      PostgreSQL (Supabase)
--
-- Architectural intent
-- --------------------
--   * `allowed_emails`   — the secure campus whitelist gatekeeper. A signup is
--                          authorized ONLY if its email exists in this table.
--   * `users`            — application profile rows, keyed 1:1 to Supabase
--                          `auth.users` via a shared UUID primary key.
--   * `assignments`      — speaking prompts issued to the cohort.
--   * `practice_sessions`— per-student timed practice ledger.
--
-- Conventions
-- -----------
--   * All timestamps are `timestamptz` defaulted to `now()` (UTC).
--   * Referential integrity is enforced with explicit foreign keys.
--   * Row Level Security (RLS) is enabled on every table; the service-role key
--     used by the backend bypasses RLS, while the browser anon key is fenced in
--     by the policies declared below.
-- ═════════════════════════════════════════════════════════════════════════════

-- Required for gen_random_uuid().
create extension if not exists "pgcrypto";

-- ─────────────────────────────────────────────────────────────────────────────
-- ENUM: user role
-- Constrains the profile role to the two roles supported in Phase 1.
-- ─────────────────────────────────────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from pg_type where typname = 'user_role') then
    create type public.user_role as enum ('student', 'instructor');
  end if;
end$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- ENUM: assignment format
-- ─────────────────────────────────────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from pg_type where typname = 'assignment_format') then
    create type public.assignment_format as enum ('extempore', 'debate', 'declamation');
  end if;
end$$;

-- ═════════════════════════════════════════════════════════════════════════════
-- TABLE: allowed_emails  (the campus whitelist gatekeeper)
-- ═════════════════════════════════════════════════════════════════════════════
create table if not exists public.allowed_emails (
  id         uuid        primary key default gen_random_uuid(),
  -- Stored lower-cased & trimmed by the application layer; uniqueness is
  -- enforced case-insensitively via the index below.
  email      text        not null,
  created_at timestamptz not null default now()
);

-- Case-insensitive uniqueness so 'Alice@Campus.edu' == 'alice@campus.edu'.
create unique index if not exists allowed_emails_email_lower_key
  on public.allowed_emails (lower(email));

comment on table public.allowed_emails is
  'Campus whitelist. Signup is authorized only if the email is present here.';

-- ═════════════════════════════════════════════════════════════════════════════
-- TABLE: users  (application profile, 1:1 with auth.users)
-- ═════════════════════════════════════════════════════════════════════════════
create table if not exists public.users (
  -- Shared primary key with Supabase auth. ON DELETE CASCADE keeps the profile
  -- lifecycle bound to the auth identity.
  id         uuid        primary key
                         references auth.users (id) on delete cascade,
  email      text        not null,
  name       text        not null,
  role       public.user_role not null default 'student',
  created_at timestamptz not null default now()
);

create unique index if not exists users_email_lower_key
  on public.users (lower(email));

comment on table public.users is
  'Application profile rows; id mirrors auth.users.id one-to-one.';

-- ═════════════════════════════════════════════════════════════════════════════
-- TABLE: assignments  (speaking prompts)
-- ═════════════════════════════════════════════════════════════════════════════
create table if not exists public.assignments (
  id          uuid        primary key default gen_random_uuid(),
  title       text        not null,
  format_type public.assignment_format not null,
  description text        not null default '',
  created_at  timestamptz not null default now()
);

comment on table public.assignments is
  'Speaking assignments issued to the cohort (extempore / debate / declamation).';

-- ═════════════════════════════════════════════════════════════════════════════
-- TABLE: practice_sessions  (per-student practice ledger)
-- ═════════════════════════════════════════════════════════════════════════════
create table if not exists public.practice_sessions (
  id               uuid        primary key default gen_random_uuid(),
  -- FK to the application profile. CASCADE so a removed student takes their
  -- practice ledger with them.
  student_id       uuid        not null
                               references public.users (id) on delete cascade,
  seconds_practiced integer    not null default 0
                               check (seconds_practiced >= 0),
  session_date     date        not null default (now() at time zone 'utc')::date
);

-- Hot query path: "all sessions for a student, most recent first".
create index if not exists practice_sessions_student_date_idx
  on public.practice_sessions (student_id, session_date desc);

comment on table public.practice_sessions is
  'Timed practice records; one row per practice session per student.';

-- ═════════════════════════════════════════════════════════════════════════════
-- ROW LEVEL SECURITY
-- Enable on all tables. The backend uses the service-role key (bypasses RLS);
-- the browser anon key is constrained to the policies below.
-- ═════════════════════════════════════════════════════════════════════════════
alter table public.allowed_emails    enable row level security;
alter table public.users             enable row level security;
alter table public.assignments       enable row level security;
alter table public.practice_sessions enable row level security;

-- allowed_emails: no client access whatsoever. Only the service role (which
-- bypasses RLS) may read it — the whitelist check happens server-side.
-- (No policies => deny-all for anon/authenticated.)

-- users: a signed-in user may read and update ONLY their own profile row.
drop policy if exists "users_select_self" on public.users;
create policy "users_select_self"
  on public.users for select
  using (auth.uid() = id);

drop policy if exists "users_update_self" on public.users;
create policy "users_update_self"
  on public.users for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- assignments: readable by any authenticated user; writes are server-side only.
drop policy if exists "assignments_select_authenticated" on public.assignments;
create policy "assignments_select_authenticated"
  on public.assignments for select
  to authenticated
  using (true);

-- practice_sessions: a student may read and insert ONLY their own rows.
drop policy if exists "practice_sessions_select_own" on public.practice_sessions;
create policy "practice_sessions_select_own"
  on public.practice_sessions for select
  using (auth.uid() = student_id);

drop policy if exists "practice_sessions_insert_own" on public.practice_sessions;
create policy "practice_sessions_insert_own"
  on public.practice_sessions for insert
  with check (auth.uid() = student_id);
