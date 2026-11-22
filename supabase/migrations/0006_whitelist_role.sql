-- ═════════════════════════════════════════════════════════════════════════════
-- Migration:   0006_whitelist_role
-- Project:     SpeakCraft — asynchronous public-speaking practice platform
-- Phase:       4 (self-service instructor/student designation)
-- Engine:      PostgreSQL (Supabase)
--
-- Intent
-- ------
--   Give the campus whitelist a `role`, so whoever curates `allowed_emails`
--   decides — up front — whether each email will become a 'student' or an
--   'instructor'. Signup then assigns that exact role, removing the need to hand-
--   edit `users.role` after the fact.
-- ═════════════════════════════════════════════════════════════════════════════

-- Add a role to the whitelist (reuses the existing public.user_role enum).
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'allowed_emails'
      and column_name = 'role'
  ) then
    alter table public.allowed_emails
      add column role public.user_role not null default 'student';
  end if;
end$$;

comment on column public.allowed_emails.role is
  'Role granted to this email at signup: student (default) or instructor.';
