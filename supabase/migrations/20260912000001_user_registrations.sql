create table if not exists public.user_registrations (
  id text primary key,
  username text not null unique,
  email text not null unique,
  password_hash text not null,
  type text not null default 'COMPANY_ADMIN',
  company_id text references public.companies(id) on update cascade,
  company_name text not null default '',
  full_name text not null,
  mobile_number text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists user_registrations_company_id_idx on public.user_registrations (company_id);

alter table public.user_registrations enable row level security;

create policy "authenticated users manage user registrations"
  on public.user_registrations
  for all to authenticated
  using (true)
  with check (true);

drop trigger if exists user_registrations_touch_updated_at on public.user_registrations;
create trigger user_registrations_touch_updated_at
  before update on public.user_registrations
  for each row execute function public.touch_updated_at();