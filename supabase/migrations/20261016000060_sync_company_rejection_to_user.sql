-- Reject the linked User Registration when a Company Registration is rejected.
-- Company approval and reopening never change the user's decision; the user
-- must be approved or reopened separately in User Registration.
create or replace function public.sync_company_rejection_to_external_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  linked_user_id text;
begin
  if new.registration_type <> 'COMPANY' or new.company_id is null
    or new.status <> 'REJECTED'
    or (old.status = new.status
      and old.rejection_reason is not distinct from new.rejection_reason
      and old.rejection_detail is not distinct from new.rejection_detail) then
    return new;
  end if;

  select id into linked_user_id
  from public.external_user_access
  where company_id = new.company_id
  order by created_at desc
  limit 1;

  if linked_user_id is not null then
    update public.external_user_access
    set status = 'REJECTED',
        rejection_reason = new.rejection_reason,
        rejection_detail = new.rejection_detail
    where id = linked_user_id;
  end if;

  return new;
end;
$$;

drop trigger if exists registration_submission_sync_external_user_rejection
  on public.registration_submissions;

create trigger registration_submission_sync_external_user_rejection
after update of status, rejection_reason, rejection_detail on public.registration_submissions
for each row execute function public.sync_company_rejection_to_external_user();
