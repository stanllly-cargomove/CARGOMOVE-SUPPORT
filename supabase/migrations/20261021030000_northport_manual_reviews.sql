alter table public.northport_recoveries add column if not exists manual_review jsonb;

create table if not exists public.northport_recovery_reviews (
  id uuid primary key default gen_random_uuid(),
  recovery_id uuid not null references public.northport_recoveries(id),
  reviewed_by uuid not null references auth.users(id),
  reviewer_email text not null,
  outcome text not null check (outcome in ('SUCCESS','FAIL')),
  note text not null check (length(trim(note)) between 5 and 1000),
  created_at timestamptz not null default now()
);
alter table public.northport_recovery_reviews enable row level security;
revoke all on public.northport_recovery_reviews from public,anon,authenticated,service_role;
grant select,insert on public.northport_recovery_reviews to service_role;

create or replace function public.northport_review_recovery(p_actor uuid,p_id uuid,p_outcome text,p_note text,p_expected_review_id uuid default null) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_recovery public.northport_recoveries; v_email text; v_review public.northport_recovery_reviews; v_result jsonb;
begin
  select a.email into v_email from auth.users a join public.user_registrations u on lower(a.email)=lower(u.email) where a.id=p_actor and u.type='ADMIN';
  if not found then raise exception 'Administrator required'; end if;
  if p_outcome not in ('SUCCESS','FAIL') or p_outcome is null or p_note is null or length(trim(p_note)) not between 5 and 1000 then raise exception 'Choose SUCCESS or FAIL and provide a verification note'; end if;
  select * into v_recovery from public.northport_recoveries where id=p_id for update;
  if not found then return jsonb_build_object('reason','unavailable'); end if;
  if v_recovery.status not in ('Uploaded','Scheduler Triggered','Processing','Verification Unavailable','Import Verified') or v_recovery.scheduler_status='Dispatching' then
    return jsonb_build_object('reason','ineligible');
  end if;
  if (v_recovery.manual_review->>'id')::uuid is distinct from p_expected_review_id then return jsonb_build_object('reason','changed'); end if;
  insert into public.northport_recovery_reviews(recovery_id,reviewed_by,reviewer_email,outcome,note)
    values(p_id,p_actor,v_email,p_outcome,trim(p_note)) returning * into v_review;
  v_result=jsonb_build_object('id',v_review.id,'outcome',v_review.outcome,'note',v_review.note,'reviewedBy',v_review.reviewer_email,'reviewedAt',v_review.created_at);
  update public.northport_recoveries set manual_review=v_result where id=p_id;
  return v_result;
end $$;
revoke all on function public.northport_review_recovery(uuid,uuid,text,text,uuid) from public,anon,authenticated;
grant execute on function public.northport_review_recovery(uuid,uuid,text,text,uuid) to service_role;
notify pgrst, 'reload schema';
