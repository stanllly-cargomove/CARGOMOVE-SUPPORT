-- Migration 2: seed the application-level admin user
-- The password is stored as a bcrypt hash in public.user_registrations.password_hash.
-- Create the matching Supabase Auth user from Authentication > Users so RLS can issue a session.

create extension if not exists pgcrypto;

insert into public.user_registrations (
  id,
  username,
  email,
  password_hash,
  type,
  company_id,
  company_name,
  full_name
) values (
  'user-admin',
  'admin',
  'admin@cargomove.local',
  crypt('123456', gen_salt('bf')),
  'ADMIN',
  null,
  '',
  'System Administrator'
)
on conflict (username) do update set
  email = excluded.email,
  password_hash = excluded.password_hash,
  type = 'ADMIN',
  full_name = excluded.full_name,
  updated_at = now();
