-- Public-facing registration progress. A company application remains pending
-- until the company submission is DONE and its user's welcome email is SENT.

create table if not exists public.registration_tracking (
  submission_id text primary key references public.registration_submissions(id) on delete cascade,
  reference_no text not null unique,
  registration_type text not null check (registration_type in ('COMPANY', 'DRIVER', 'TRAILER', 'VEHICLE')),
  company_id text references public.companies(id) on update cascade,
  external_user_id text references public.external_user_access(id) on update cascade on delete set null,
  company_name text not null default '',
  port_location text not null check (port_location in ('PORT_KLANG', 'JOHOR', 'OTHER')),
  submission_status text not null default 'PENDING' check (submission_status in ('PENDING', 'DONE', 'REJECTED')),
  user_email_sent boolean not null default false,
  status text not null default 'PENDING' check (status in ('PENDING', 'SUCCESS', 'REJECTED')),
  submitted_at timestamptz not null,
  completed_at timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists registration_tracking_company_id_idx
  on public.registration_tracking (company_id);
create index if not exists registration_tracking_external_user_id_idx
  on public.registration_tracking (external_user_id);

alter table public.registration_tracking enable row level security;

-- Tracking is exposed only through the limited server endpoint. Administrators
-- can inspect it directly while anonymous users cannot enumerate applications.
drop policy if exists "authenticated users read registration tracking" on public.registration_tracking;
create policy "authenticated users read registration tracking"
  on public.registration_tracking for select to authenticated using (true);

create or replace function public.sync_registration_tracking_from_submission()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  linked_user public.external_user_access%rowtype;
  email_was_sent boolean := false;
  tracking_status text;
begin
  if new.registration_type = 'COMPANY' then
    select * into linked_user
    from public.external_user_access
    where company_id = new.company_id
    order by created_at desc
    limit 1;
    email_was_sent := coalesce(linked_user.email_sent = 1 and linked_user.email_status = 'SENT', false);
  end if;

  tracking_status := case
    when new.status = 'REJECTED' then 'REJECTED'
    when new.registration_type = 'COMPANY' and new.status = 'DONE' and email_was_sent then 'SUCCESS'
    when new.registration_type <> 'COMPANY' and new.status = 'DONE' then 'SUCCESS'
    else 'PENDING'
  end;

  insert into public.registration_tracking (
    submission_id, reference_no, registration_type, company_id,
    external_user_id, company_name, port_location, submission_status,
    user_email_sent, status, submitted_at, completed_at, updated_at
  ) values (
    new.id, new.reference_no, new.registration_type, new.company_id,
    linked_user.id, new.company_name, new.port_location, new.status,
    email_was_sent, tracking_status, new.submitted_at,
    case when tracking_status = 'SUCCESS' then now() else null end, now()
  )
  on conflict (submission_id) do update set
    reference_no = excluded.reference_no,
    registration_type = excluded.registration_type,
    company_id = excluded.company_id,
    external_user_id = excluded.external_user_id,
    company_name = excluded.company_name,
    port_location = excluded.port_location,
    submission_status = excluded.submission_status,
    user_email_sent = excluded.user_email_sent,
    status = excluded.status,
    completed_at = case
      when excluded.status = 'SUCCESS' then coalesce(public.registration_tracking.completed_at, now())
      else null
    end,
    updated_at = now();

  return new;
end;
$$;

create or replace function public.sync_registration_tracking_from_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  email_was_sent boolean;
begin
  email_was_sent := new.email_sent = 1 and new.email_status = 'SENT';

  if tg_op = 'UPDATE' and old.company_id is distinct from new.company_id then
    update public.registration_tracking
    set
      external_user_id = null,
      user_email_sent = false,
      status = case when submission_status = 'REJECTED' then 'REJECTED' else 'PENDING' end,
      completed_at = null,
      updated_at = now()
    where external_user_id = old.id;
  end if;

  update public.registration_tracking
  set
    external_user_id = new.id,
    user_email_sent = email_was_sent,
    status = case
      when submission_status = 'REJECTED' then 'REJECTED'
      when submission_status = 'DONE' and email_was_sent then 'SUCCESS'
      else 'PENDING'
    end,
    completed_at = case
      when submission_status = 'DONE' and email_was_sent then coalesce(completed_at, now())
      else null
    end,
    updated_at = now()
  where registration_type = 'COMPANY'
    and company_id = new.company_id;

  return new;
end;
$$;

create or replace function public.clear_registration_tracking_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.registration_tracking
  set
    external_user_id = null,
    user_email_sent = false,
    status = case when submission_status = 'REJECTED' then 'REJECTED' else 'PENDING' end,
    completed_at = null,
    updated_at = now()
  where external_user_id = old.id
    or (registration_type = 'COMPANY' and company_id = old.company_id);
  return old;
end;
$$;

drop trigger if exists registration_submission_sync_tracking on public.registration_submissions;
create trigger registration_submission_sync_tracking
after insert or update of status, company_id, company_name, port_location on public.registration_submissions
for each row execute function public.sync_registration_tracking_from_submission();

drop trigger if exists external_user_sync_registration_tracking on public.external_user_access;
create trigger external_user_sync_registration_tracking
after insert or update of company_id, status, email_sent, email_status on public.external_user_access
for each row execute function public.sync_registration_tracking_from_user();

drop trigger if exists external_user_clear_registration_tracking on public.external_user_access;
create trigger external_user_clear_registration_tracking
after delete on public.external_user_access
for each row execute function public.clear_registration_tracking_user();

-- Populate tracking for registrations created before this migration.
insert into public.registration_tracking (
  submission_id, reference_no, registration_type, company_id,
  external_user_id, company_name, port_location, submission_status,
  user_email_sent, status, submitted_at, completed_at, updated_at
)
select
  submission.id,
  submission.reference_no,
  submission.registration_type,
  submission.company_id,
  linked_user.id,
  submission.company_name,
  submission.port_location,
  submission.status,
  coalesce(linked_user.email_sent = 1 and linked_user.email_status = 'SENT', false),
  case
    when submission.status = 'REJECTED' then 'REJECTED'
    when submission.registration_type = 'COMPANY'
      and submission.status = 'DONE'
      and linked_user.email_sent = 1
      and linked_user.email_status = 'SENT' then 'SUCCESS'
    when submission.registration_type <> 'COMPANY' and submission.status = 'DONE' then 'SUCCESS'
    else 'PENDING'
  end,
  submission.submitted_at,
  case
    when submission.status = 'DONE' and (
      submission.registration_type <> 'COMPANY'
      or (linked_user.email_sent = 1 and linked_user.email_status = 'SENT')
    ) then coalesce(submission.reviewed_at, submission.updated_at, now())
    else null
  end,
  now()
from public.registration_submissions submission
left join lateral (
  select external_user.id, external_user.email_sent, external_user.email_status
  from public.external_user_access external_user
  where external_user.company_id = submission.company_id
  order by external_user.created_at desc
  limit 1
) linked_user on submission.registration_type = 'COMPANY'
on conflict (submission_id) do nothing;
