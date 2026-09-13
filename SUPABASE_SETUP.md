# Supabase setup

1. Create a new Supabase project and copy the project URL and anon/publishable key.
2. In the Supabase SQL editor, run only `supabase/migrations/20260913000000_init.sql`.
3. In **Authentication → Users**, create and confirm `support@cargomove.com.my`. Set its password there; Supabase Auth owns the password.
4. Configure the Supabase Auth Site URL and redirect URLs for the deployed Vercel app and local development.
5. Configure `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, and a long random `SESSION_SECRET` in Vercel Project Settings. Do not expose server keys as `VITE_*` variables.
6. For local development, keep server variables in ignored `.env.local`; for deployment, add them to Vercel Project Settings. Never commit them. For the initial demo data, run `npx tsx scripts/seed-supabase.ts` from a trusted environment with the server variables available.
7. Start the API with `npm run dev:api` only when those server variables are provided by your local process.

## Credential rules

- Never commit `.env.local`, a service-role key, or a database password.
- Only `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` may reach the browser. The anon key is protected by Row Level Security; it is not a secret.
- The service-role key bypasses RLS. Use it only for the seed script or a trusted backend and rotate it immediately if exposed.
- The admin UI uses a custom HttpOnly API session after Supabase Auth verifies the password. The public registration page does not hydrate the protected snapshot; company, submission, user-registration, and guideline data are fetched only after successful login.
- The application authorization row is stored in `public.user_registrations`; its `type` must be `ADMIN`. Its legacy `password_hash` column is retained for registration data compatibility and is not used for admin login.
- The API uses the server-only service-role key to read/write protected tables. Never put that key in a `VITE_*` variable or browser code.
- Do not put third-party API credentials or Supabase service credentials in React components or `VITE_*` variables.
