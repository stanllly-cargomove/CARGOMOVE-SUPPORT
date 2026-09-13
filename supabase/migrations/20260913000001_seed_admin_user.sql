-- Migration 2: seed the initial admin Auth user
-- Login username: admin
-- Login email: admin@cargomove.local
-- Login password: 123456
-- Change this password immediately after the first login.

create extension if not exists pgcrypto;

do $$
declare
  admin_id uuid;
begin
  select id into admin_id
  from auth.users
  where email = 'admin@cargomove.local';

  if admin_id is null then
    admin_id := gen_random_uuid();

    insert into auth.users (
      id,
      instance_id,
      aud,
      role,
      email,
      encrypted_password,
      email_confirmed_at,
      confirmation_sent_at,
      last_sign_in_at,
      raw_app_meta_data,
      raw_user_meta_data,
      created_at,
      updated_at
    ) values (
      admin_id,
      '00000000-0000-0000-0000-000000000000',
      'authenticated',
      'authenticated',
      'admin@cargomove.local',
      crypt('123456', gen_salt('bf')),
      now(),
      now(),
      null,
      jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
      jsonb_build_object('username', 'admin', 'role', 'ADMIN'),
      now(),
      now()
    );
  end if;

  insert into public.user_profiles (id, email, full_name, role, active)
  values (admin_id, 'admin@cargomove.local', 'System Administrator', 'ADMIN', true)
  on conflict (id) do update set
    email = excluded.email,
    role = 'ADMIN',
    active = true,
    updated_at = now();
end;
$$;
