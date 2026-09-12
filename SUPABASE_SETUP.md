# Supabase setup

1. Create a Supabase project and copy the project URL and anon/publishable key.
2. In the Supabase SQL editor, run `supabase/migrations/20260912000000_initial_schema.sql`.
3. Copy `.env.example` to `.env.local` and set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
4. For the initial demo data, also set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in `.env.local`, then run `npx tsx scripts/seed-supabase.ts`.
5. Start the app with `npm run dev`.

## Credential rules

- Never commit `.env.local`, a service-role key, or a database password.
- Only `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` may reach the browser. The anon key is protected by Row Level Security; it is not a secret.
- The service-role key bypasses RLS. Use it only for the seed script or a trusted backend and rotate it immediately if exposed.
- The current UI has no login flow. RLS therefore allows public reads only for active port/depot configuration and requires an authenticated Supabase user for company, submission, guideline, and admin writes. Add Supabase Auth before exposing the admin screens in production.
- Do not put third-party API credentials or Supabase service credentials in React components or `VITE_*` variables.