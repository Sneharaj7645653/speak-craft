-- Isolated local/staging seed data only.
-- Synthetic identities use the @local.test domain and fixed UUID prefixes.

delete from public.evaluations
where student_id in (
  select id from public.users where email like 'bench%@local.test'
);

delete from public.speaking_sessions
where student_id in (
  select id from public.users where email like 'bench%@local.test'
);

delete from public.student_assignments
where student_id in (
  select id from public.users where email like 'bench%@local.test'
);

delete from public.practice_sessions
where student_id in (
  select id from public.users where email like 'bench%@local.test'
);

delete from public.users
where email like 'bench%@local.test';

delete from auth.users
where email like 'bench%@local.test';

delete from public.allowed_emails
where email like 'bench%@local.test';

delete from public.assignments
where id::text like '20000000-%';

with ids as (
  select
    i,
    ('10000000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid as id,
    ('bench' || lpad(i::text, 4, '0') || '@local.test') as email
  from generate_series(1, 300) i
)
insert into auth.users (
  instance_id,
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  confirmation_token,
  recovery_token,
  email_change_token_new,
  email_change,
  phone_change,
  phone_change_token,
  email_change_token_current,
  reauthentication_token,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at,
  is_sso_user,
  is_anonymous
)
select
  '00000000-0000-0000-0000-000000000000',
  id,
  'authenticated',
  'authenticated',
  email,
  crypt('local-only-password', gen_salt('bf')),
  now(),
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '{"provider":"email","providers":["email"]}'::jsonb,
  jsonb_build_object('name', 'Synthetic Student ' || i),
  now(),
  now(),
  false,
  false
from ids;

insert into public.allowed_emails (email, role)
select email, 'student'
from auth.users
where email like 'bench%@local.test';

insert into public.users (id, email, name, role)
select
  id,
  email,
  'Synthetic Student ' || substr(email, 5, 4),
  'student'
from auth.users
where email like 'bench%@local.test';

insert into public.assignments (id, title, format_type, description)
select
  ('20000000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid,
  'Synthetic Assignment ' || i,
  case i % 3
    when 0 then 'declamation'
    when 1 then 'extempore'
    else 'debate'
  end::public.assignment_format,
  'Synthetic benchmark prompt ' || i
from generate_series(1, 10) i;

insert into public.student_assignments (assignment_id, student_id, status)
select
  a.id,
  u.id,
  'assigned'
from public.assignments a
cross join public.users u
where u.email like 'bench%@local.test';

-- Synthetic 400-day streak history for bench0300.
insert into public.practice_sessions (student_id, session_date, seconds_practiced)
select
  ('10000000-0000-4000-8000-' || lpad('300', 12, '0'))::uuid,
  (current_date - offs)::date,
  600
from generate_series(0, 399) offs;
