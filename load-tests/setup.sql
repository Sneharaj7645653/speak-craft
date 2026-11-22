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
values (
  '00000000-0000-0000-0000-000000000000',
  '40000000-0000-4000-8000-000000000001',
  'authenticated',
  'authenticated',
  'loadtest-instructor@local.test',
  crypt('loadtest-local-only-password', gen_salt('bf')),
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
  '{"name":"Synthetic Load Test Instructor"}'::jsonb,
  now(),
  now(),
  false,
  false
)
on conflict (id) do update
set email = excluded.email,
    encrypted_password = excluded.encrypted_password,
    email_confirmed_at = excluded.email_confirmed_at,
    confirmation_token = excluded.confirmation_token,
    recovery_token = excluded.recovery_token,
    email_change_token_new = excluded.email_change_token_new,
    email_change = excluded.email_change,
    phone_change = excluded.phone_change,
    phone_change_token = excluded.phone_change_token,
    email_change_token_current = excluded.email_change_token_current,
    reauthentication_token = excluded.reauthentication_token,
    raw_app_meta_data = excluded.raw_app_meta_data,
    raw_user_meta_data = excluded.raw_user_meta_data,
    updated_at = now();

insert into public.allowed_emails (email, role)
values ('loadtest-instructor@local.test', 'instructor')
on conflict (lower(email)) do update set role = excluded.role;

insert into public.users (id, email, name, role)
values (
  '40000000-0000-4000-8000-000000000001',
  'loadtest-instructor@local.test',
  'Synthetic Load Test Instructor',
  'instructor'
)
on conflict (id) do update
set email = excluded.email,
    name = excluded.name,
    role = excluded.role;
