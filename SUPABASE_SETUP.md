# Supabase setup

1. Create a Supabase project and copy the project URL and anon/publishable key.
2. In the Supabase SQL editor, run `supabase/migrations/20260912000000_initial_schema.sql`.
3. Run `supabase/migrations/20260913000000_migration_1_user_table.sql` to create authenticated user profiles.
4. Run `supabase/migrations/20260913000001_seed_admin_application_user.sql` to create the application user row with a bcrypt password hash.
5. Run `supabase/migrations/20260913000003_remove_auth_profile_dependency.sql` and `supabase/migrations/20260913000004_application_login.sql` to remove Auth dependencies and create the server-only password verification function.
6. Configure `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and a long random `SESSION_SECRET` in the server/deployment secret store, such as Vercel Project Settings. Do not add them to `.env.local` or expose them as `VITE_*` variables.
7. For the initial demo data, run `npx tsx scripts/seed-supabase.ts` from a trusted environment with the server variables available.
8. Start the API with `npm run dev:api` only when those server variables are provided by your local process; the frontend itself does not need any new `.env.local` values.

## Credential rules

- Never commit `.env.local`, a service-role key, or a database password.
- Only `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` may reach the browser. The anon key is protected by Row Level Security; it is not a secret.
- The service-role key bypasses RLS. Use it only for the seed script or a trusted backend and rotate it immediately if exposed.
- The admin UI uses the custom API session, not Supabase Auth. The public registration page does not hydrate the protected snapshot; company, submission, user-registration, and guideline data are fetched only after successful login.
- The application user row is stored in `public.user_registrations`; its password is stored only as a bcrypt hash and is verified server-side.
- The API uses the server-only service-role key to read/write protected tables. Never put that key in a `VITE_*` variable or browser code.
- Do not put third-party API credentials or Supabase service credentials in React components or `VITE_*` variables.