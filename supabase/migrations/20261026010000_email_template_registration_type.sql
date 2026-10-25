alter table public.email_templates
  add column if not exists registration_type text;

update public.email_templates
set registration_type = case id
  when 'cargomove-welcome' then 'COMPANY'
  when 'rejection-already-registered-both' then 'COMPANY'
  when 'rejection-northport-added' then 'COMPANY'
  when 'rejection-no-ledger-code' then 'COMPANY'
  when 'rejection-other' then 'COMPANY'
  when 'acceptance-driver' then 'DRIVER'
  when 'acceptance-trailer' then 'TRAILER'
  when 'acceptance-vehicle' then 'VEHICLE'
  else registration_type
end
where registration_type is null
  and id in ('cargomove-welcome', 'rejection-already-registered-both', 'rejection-northport-added', 'rejection-no-ledger-code', 'rejection-other', 'acceptance-driver', 'acceptance-trailer', 'acceptance-vehicle');

alter table public.email_templates
  drop constraint if exists email_templates_registration_type_check,
  add constraint email_templates_registration_type_check check (
    registration_type is null or registration_type in ('COMPANY', 'DRIVER', 'TRAILER', 'VEHICLE')
  );
