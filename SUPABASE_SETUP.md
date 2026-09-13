# Supabase setup

1. Create a Supabase project and copy the project URL and anon/publishable key.
2. In the Supabase SQL editor, run `supabase/migrations/20260912000000_initial_schema.sql`.
3. Run `supabase/migrations/20260913000000_migration_1_user_table.sql` to create authenticated user profiles.
4. Run `supabase/migrations/20260913000001_seed_admin_application_user.sql` to create the application user row with a bcrypt password hash.
5. Run `supabase/migrations/20260913000002_repair_auth_profile_trigger.sql` to make Auth profile synchronization non-blocking.
6. In Supabase Authentication, create the matching `admin@cargomove.local` user. Do not insert directly into `auth.users` with SQL; Auth needs to create its identity and session data.
7. Copy `.env.example` to `.env.local` and set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
8. For the initial demo data, also set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in `.env.local`, then run `npx tsx scripts/seed-supabase.ts`.
9. Start the app with `npm run dev`.

## Credential rules

- Never commit `.env.local`, a service-role key, or a database password.
- Only `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` may reach the browser. The anon key is protected by Row Level Security; it is not a secret.
- The service-role key bypasses RLS. Use it only for the seed script or a trusted backend and rotate it immediately if exposed.
- The admin UI uses Supabase Auth. The public registration page does not hydrate the protected snapshot; company, submission, user-registration, and guideline data are fetched only after successful login.
- RLS requires an authenticated Supabase user for company, submission, guideline, and admin writes. Apply Migration 1 before using the login flow.
- The application user row is stored in `public.user_registrations`; its password is stored only as a bcrypt hash. Supabase Auth still owns the browser session and must contain the matching email user.
- To remove the Auth profile trigger, run `supabase/migrations/20260913000003_remove_auth_profile_dependency.sql`. A secure custom login without Supabase Auth requires a backend session/API; do not weaken RLS policies to make protected tables public.
- Do not put third-party API credentials or Supabase service credentials in React components or `VITE_*` variables.