-- Migration 3: repair the seeded admin Auth identity
-- The password is stored only as a bcrypt hash in auth.users.encrypted_password.
-- It is never stored in public.user_profiles.

create extension if not exists pgcrypto;

do $$
declare
  admin_user_id uuid;
begin
  select id into admin_user_id
  from auth.users
  where email = 'admin@cargomove.local';

  if admin_user_id is null then
    admin_user_id := gen_random_uuid();

    insert into auth.users (
      id,
      instance_id,
      aud,
      role,
      email,
      encrypted_password,
      email_confirmed_at,
      raw_app_meta_data,
      raw_user_meta_data,
      created_at,
      updated_at
    ) values (
      admin_user_id,
      '00000000-0000-0000-0000-000000000000',
      'authenticated',
      'authenticated',
      'admin@cargomove.local',
      crypt('123456', gen_salt('bf')),
      now(),
      jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
      jsonb_build_object('username', 'admin', 'role', 'ADMIN'),
      now(),
      now()
    );
  else
    update auth.users
    set encrypted_password = crypt('123456', gen_salt('bf')),
        email_confirmed_at = coalesce(email_confirmed_at, now()),
        updated_at = now()
    where id = admin_user_id;
  end if;

  insert into auth.identities (
    id,
    user_id,
    provider_id,
    identity_data,
    provider,
    created_at,
    updated_at
  ) values (
    admin_user_id,
    admin_user_id,
    'admin@cargomove.local',
    jsonb_build_object(
      'sub', admin_user_id::text,
      'email', 'admin@cargomove.local'
    ),
    'email',
    now(),
    now()
  )
  on conflict (provider_id, provider) do update set
    user_id = excluded.user_id,
    identity_data = excluded.identity_data,
    updated_at = now();

  insert into public.user_profiles (id, email, full_name, role, active)
  values (admin_user_id, 'admin@cargomove.local', 'System Administrator', 'ADMIN', true)
  on conflict (id) do update set
    email = excluded.email,
    role = 'ADMIN',
    active = true,
    updated_at = now();
end;
$$;
