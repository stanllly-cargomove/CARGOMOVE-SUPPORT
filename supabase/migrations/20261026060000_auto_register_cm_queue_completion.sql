-- Manual Register & Email and automatic processing share the same queue.
-- Closing a stale queue item does not create an automatic execution or email.
create function public.reconcile_auto_register_cm_submission_queue() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if new.status in ('DONE','REJECTED') or new.cargomove_upload->>'state'='SUCCESS' then
    update public.auto_register_cm_scheduled_items
    set status=case when new.status='REJECTED' then 'FAILED' else 'SUCCESS' end,
      completed_at=now(),
      message=case when new.status='REJECTED' then 'Registration rejected; removed from automatic scheduling.'
        when new.status='DONE' then 'Registration already completed; removed from scheduling without another upload or email.'
        else 'CargoMove upload already verified; removed from scheduling. Acceptance email is handled separately.' end
    where submission_id=new.id and status='SCHEDULED';
  end if;
  return new;
end $$;

create trigger reconcile_auto_register_cm_submission_queue
after update of status,cargomove_upload on public.registration_submissions
for each row execute function public.reconcile_auto_register_cm_submission_queue();

-- A stale browser or in-flight scheduler must not reopen a completed item.
create function public.guard_auto_register_cm_completed_queue() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_sub public.registration_submissions%rowtype;
begin
  if new.status<>'SCHEDULED' then return new; end if;
  select * into v_sub from public.registration_submissions where id=new.submission_id;
  if v_sub.status in ('DONE','REJECTED') or v_sub.cargomove_upload->>'state'='SUCCESS' then
    new.status=case when v_sub.status='REJECTED' then 'FAILED' else 'SUCCESS' end;
    new.completed_at=now();
    new.message=case when v_sub.status='REJECTED' then 'Registration rejected; removed from automatic scheduling.'
      else 'Registration already completed or verified; no further automatic upload is required.' end;
  end if;
  return new;
end $$;

create trigger guard_auto_register_cm_completed_queue
before insert or update on public.auto_register_cm_scheduled_items
for each row execute function public.guard_auto_register_cm_completed_queue();

revoke all on function public.reconcile_auto_register_cm_submission_queue(),
  public.guard_auto_register_cm_completed_queue() from public,anon,authenticated;

-- Repair previously completed manual registrations, preserving all run links.
update public.auto_register_cm_scheduled_items q
set status=case when s.status='REJECTED' then 'FAILED' else 'SUCCESS' end,
  completed_at=now(),
  message=case when s.status='REJECTED' then 'Registration rejected; stale schedule closed.'
    else 'Registration already completed or verified; stale schedule closed without another upload or email.' end
from public.registration_submissions s
where q.submission_id=s.id and q.status='SCHEDULED'
  and (s.status in ('DONE','REJECTED') or s.cargomove_upload->>'state'='SUCCESS');
