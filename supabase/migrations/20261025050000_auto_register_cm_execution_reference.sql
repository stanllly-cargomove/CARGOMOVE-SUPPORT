create sequence public.auto_register_cm_execution_reference_seq
  start with 1000001
  increment by 1
  no minvalue
  no maxvalue
  cache 1;

alter table public.automation_scheduler_runs
  add column execution_reference text;

update public.automation_scheduler_runs
set execution_reference = 'AUTOREG' || lpad(nextval('public.auto_register_cm_execution_reference_seq')::text, 7, '0')
where scheduler_key = 'auto_register_cm'
  and execution_reference is null;

create function public.assign_auto_register_cm_execution_reference()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.scheduler_key = 'auto_register_cm' and new.execution_reference is null then
    new.execution_reference := 'AUTOREG' || lpad(nextval('public.auto_register_cm_execution_reference_seq')::text, 7, '0');
  end if;
  return new;
end;
$$;

create trigger assign_auto_register_cm_execution_reference
before insert on public.automation_scheduler_runs
for each row execute function public.assign_auto_register_cm_execution_reference();

create unique index automation_scheduler_runs_auto_register_reference_idx
  on public.automation_scheduler_runs(execution_reference)
  where scheduler_key = 'auto_register_cm' and execution_reference is not null;
