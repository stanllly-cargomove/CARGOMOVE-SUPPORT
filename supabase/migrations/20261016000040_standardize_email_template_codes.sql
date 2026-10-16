-- Normalize previously created free-form codes without changing template IDs,
-- port assignments, or the code snapshots already stored in email logs.
with invalid_codes as (
  select id, trigger_status,
    row_number() over (partition by trigger_status order by id) as slot
  from public.email_templates
  where template_code is not null
    and not (
      (trigger_status = 'DONE' and template_code ~ '^ACC[0-9]{3}$')
      or (trigger_status = 'REJECTED' and template_code ~ '^REJ[0-9]{3}$')
    )
), available_codes as (
  select outcome.trigger_status,
    outcome.prefix || lpad(numbers.number::text, 3, '0') as template_code,
    row_number() over (partition by outcome.trigger_status order by numbers.number) as slot
  from (values ('DONE', 'ACC'), ('REJECTED', 'REJ')) as outcome(trigger_status, prefix)
  cross join generate_series(1, 999) as numbers(number)
  where not exists (
    select 1 from public.email_templates existing
    where existing.trigger_status = outcome.trigger_status
      and existing.template_code = outcome.prefix || lpad(numbers.number::text, 3, '0')
  )
)
update public.email_templates template
set template_code = available.template_code
from invalid_codes invalid
join available_codes available
  on available.trigger_status = invalid.trigger_status and available.slot = invalid.slot
where template.id = invalid.id;

alter table public.email_templates
  drop constraint if exists email_templates_port_code_check,
  add constraint email_templates_port_code_check check (
    port_id is null and (
      template_code is null
      or (trigger_status = 'DONE' and template_code ~ '^ACC[0-9]{3}$')
      or (trigger_status = 'REJECTED' and template_code ~ '^REJ[0-9]{3}$')
    )
  );
