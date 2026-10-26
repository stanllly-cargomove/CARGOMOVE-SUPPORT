-- Keep uncertain sends visible in execution results. Application code inspects
-- their receipt and reports review required; it never sends them again.
create or replace function public.auto_register_cm_email_candidates() returns setof public.registration_submissions
language sql stable security definer set search_path=public,pg_temp as $$
  select s.* from public.registration_submissions s
  where s.status='PENDING' and s.registration_type in ('DRIVER','TRAILER','VEHICLE')
    and s.cargomove_upload->>'state'='SUCCESS'
    and exists(select 1 from public.auto_register_cm_scheduled_items q
      where q.submission_id=s.id and q.status='SUCCESS')
  order by s.submitted_at,s.id limit 100;
$$;
revoke all on function public.auto_register_cm_email_candidates() from public,anon,authenticated;
grant execute on function public.auto_register_cm_email_candidates() to service_role;
