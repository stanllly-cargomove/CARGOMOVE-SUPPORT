-- Migration 4: remove the application profile trigger from Supabase Auth
-- Application users are stored in public.user_registrations.
-- A secure custom login for that table requires a trusted backend session/API;
-- do not make protected tables public just to bypass RLS.

drop trigger if exists on_auth_user_created on auth.users;
drop function if exists public.create_user_profile();

-- user_profiles is no longer part of the application login flow.
-- It is intentionally left in place so this migration is non-destructive.
