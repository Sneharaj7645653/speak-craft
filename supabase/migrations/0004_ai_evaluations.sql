-- ═════════════════════════════════════════════════════════════════════════════
-- Migration:   0004_ai_evaluations
-- Project:     SpeakCraft — asynchronous public-speaking practice platform
-- Phase:       4 (Intelligent Multi-LLM Voice Coach Engine)
-- Engine:      PostgreSQL (Supabase)
--
-- Architectural intent
-- --------------------
--   Stores the OUTPUT of an AI coaching run — never the audio. Per the audio
--   storage-safety rule, no .wav/.mp3 binaries are persisted; only the text
--   transcript (produced client-side), the consolidated textual analysis, the
--   numeric performance score, lightweight delivery metrics, and which LLM
--   provider fulfilled the request.
-- ═════════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────
-- ENUM: which LLM provider produced the evaluation (primary vs. fallback).
-- ─────────────────────────────────────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from pg_type where typname = 'ai_provider') then
    create type public.ai_provider as enum ('groq', 'gemini');
  end if;
end$$;

-- ═════════════════════════════════════════════════════════════════════════════
-- TABLE: evaluations
-- ═════════════════════════════════════════════════════════════════════════════
create table if not exists public.evaluations (
  id                uuid        primary key default gen_random_uuid(),
  student_id        uuid        not null
                                references public.users (id) on delete cascade,
  -- NULL => free-practice coaching. Non-NULL => coaching on a formal attempt.
  assignment_id     uuid        references public.assignments (id) on delete set null,
  attempt_number    integer     check (attempt_number is null or attempt_number >= 1),
  -- The client-side transcript (Web Speech API). Text only — never audio.
  transcript        text        not null,
  -- The full consolidated Sandwich-Method analysis emitted by the coach.
  feedback          text        not null,
  -- Delivery proxy score in [0, 100] computed server-side from the transcript.
  score             integer     not null check (score between 0 and 100),
  -- Which provider actually served the stream (records failover outcomes).
  provider          public.ai_provider not null,
  -- Lightweight structured metrics.
  word_count        integer     not null default 0 check (word_count >= 0),
  filler_word_count integer     not null default 0 check (filler_word_count >= 0),
  created_at        timestamptz not null default now()
);

-- Hot query path: "a student's evaluations, most recent first".
create index if not exists evaluations_student_created_idx
  on public.evaluations (student_id, created_at desc);

-- Hot query path: "all evaluations for an assignment attempt".
create index if not exists evaluations_assignment_idx
  on public.evaluations (assignment_id);

comment on table public.evaluations is
  'AI coaching results: text transcript, Sandwich-Method analysis, score, metrics, and serving provider. No audio is ever stored.';

-- ═════════════════════════════════════════════════════════════════════════════
-- ROW LEVEL SECURITY (defense-in-depth; the server writes via the service role).
-- Students may read only their own evaluations.
-- ═════════════════════════════════════════════════════════════════════════════
alter table public.evaluations enable row level security;

drop policy if exists "evaluations_select_own" on public.evaluations;
create policy "evaluations_select_own"
  on public.evaluations for select
  using (auth.uid() = student_id);
