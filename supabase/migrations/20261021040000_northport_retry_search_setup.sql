-- Retain the original EIR search settings; retry is a new read-only search.
alter table public.northport_recoveries add column if not exists search_setup jsonb;
notify pgrst, 'reload schema';
