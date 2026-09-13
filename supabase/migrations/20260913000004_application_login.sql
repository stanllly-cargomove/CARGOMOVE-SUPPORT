-- Migration 5: application-table login without Supabase Auth
-- The trusted API calls this function with the service-role connection.
-- password_hash is never returned by the function.

create extension if not exists pgcrypto;

create or replace function public.verify_application_login(
  login_identifier text,
  login_password text
)
returns table (
  id text,
  username text,
  email text,
  type text,
  full_name text
)
language sql
security definer
set search_path = public
as $$
  select u.id, u.username, u.email, u.type, u.full_name
  from public.user_registrations u
  where (lower(u.username) = lower(login_identifier) or lower(u.email) = lower(login_identifier))
    and u.type = 'ADMIN'
    and crypt(login_password, u.password_hash) = u.password_hash;
$$;

revoke all on function public.verify_application_login(text, text) from public;
revoke all on function public.verify_application_login(text, text) from anon;
revoke all on function public.verify_application_login(text, text) from authenticated;
grant execute on function public.verify_application_login(text, text) to service_role;

-- Remove the remaining schema references to Supabase Auth.
alter table if exists public.haulier_guidelines
  drop constraint if exists haulier_guidelines_updated_by_fkey;
drop table if exists public.user_profiles;
