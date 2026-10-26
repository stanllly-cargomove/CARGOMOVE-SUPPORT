-- Shared by automatic and manual acceptance emails. An uncertain send is never
-- reclaimed automatically: reconcile Gmail before an operator releases it.
alter table public.auto_register_cm_scheduled_items add column last_attempted_at timestamptz;
create index auto_register_cm_scheduled_items_fair_queue_idx
  on public.auto_register_cm_scheduled_items(last_attempted_at nulls first,scheduled_at) where status='SCHEDULED';

create table public.registration_acceptance_deliveries (
  submission_id text not null,
  upload_id uuid not null,
  state text not null check (state in ('SENDING','SENT','FAILED')),
  gmail_message_id text,
  updated_at timestamptz not null default now(),
  primary key (submission_id,upload_id)
);
alter table public.registration_acceptance_deliveries enable row level security;
revoke all on public.registration_acceptance_deliveries from public,anon,authenticated;
grant select,insert,update on public.registration_acceptance_deliveries to service_role;

create function public.claim_registration_acceptance(p_submission_id text,p_upload_id uuid) returns text
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_state text;
begin
  perform 1 from public.registration_submissions where id=p_submission_id and status='PENDING'
    and cargomove_upload->>'state'='SUCCESS' and cargomove_upload->>'id'=p_upload_id::text for update;
  if not found then raise exception 'Verified Pending registration required'; end if;
  select state into v_state from public.registration_acceptance_deliveries
    where submission_id=p_submission_id and upload_id=p_upload_id for update;
  if v_state in ('SENDING','SENT') then return v_state; end if;
  insert into public.registration_acceptance_deliveries(submission_id,upload_id,state)
    values(p_submission_id,p_upload_id,'SENDING')
    on conflict (submission_id,upload_id) do update set state='SENDING',updated_at=now();
  return 'CLAIMED';
end $$;

create function public.auto_register_cm_email_candidates() returns setof public.registration_submissions
language sql stable security definer set search_path=public,pg_temp as $$
  select s.* from public.registration_submissions s
  where s.status='PENDING' and s.registration_type in ('DRIVER','TRAILER','VEHICLE')
    and s.cargomove_upload->>'state'='SUCCESS'
    and exists(select 1 from public.auto_register_cm_scheduled_items q
      where q.submission_id=s.id and q.status='SUCCESS')
    and not exists(select 1 from public.registration_acceptance_deliveries d
      where d.submission_id=s.id and d.upload_id::text=s.cargomove_upload->>'id' and d.state='SENDING')
  order by s.submitted_at,s.id limit 100;
$$;
revoke all on function public.claim_registration_acceptance(text,uuid),public.auto_register_cm_email_candidates() from public,anon,authenticated;
grant execute on function public.claim_registration_acceptance(text,uuid),public.auto_register_cm_email_candidates() to service_role;

update public.automation_schedulers set schedule='Every 20 minutes',updated_at=now()
  where scheduler_key='auto_register_cm';
