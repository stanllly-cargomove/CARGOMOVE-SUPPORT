-- Move the application admin alias to the real support mailbox.
-- The password is managed by Supabase Auth, not this application table.
update public.user_registrations
set
  email = 'support@cargomove.com.my',
  updated_at = now()
where username = 'admin'
  and email = 'admin@cargomove.local';

-- Do not delete from auth.users in a migration. Delete the old Auth user
-- from Authentication > Users, then create a new confirmed user with the
-- email support@cargomove.com.my and set its password there.
