-- Migration 3: make Auth profile synchronization non-blocking
-- Passwords remain in Supabase Auth; application credentials remain in
-- public.user_registrations.password_hash.

create or replace function public.create_user_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.user_profiles (id, email)
  values (new.id, coalesce(new.email, ''))
  on conflict (id) do update set
    email = excluded.email,
    updated_at = now();
  return new;
exception when others then
  raise warning 'Unable to create user profile for Auth user %: %', new.id, sqlerrm;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.create_user_profile();
