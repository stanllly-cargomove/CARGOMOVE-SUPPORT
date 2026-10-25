-- Company Master is the canonical source for company identity and contact data.
-- Queue rows retain a denormalized snapshot for filtering, exports, and review,
-- so propagate master edits without changing submission-specific operational data.

create or replace function public.sync_company_details_from_master()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_registration_number text;
  v_company_data jsonb;
begin
  v_registration_number := upper(coalesce(
    nullif(btrim(new.registration_number_old), ''),
    nullif(btrim(new.registration_number_new), ''),
    btrim(new.registration_number)
  ));

  v_company_data := jsonb_build_object(
    'registration_number', new.registration_number,
    'registration_number_old', new.registration_number_old,
    'registration_number_new', new.registration_number_new,
    'name', new.name,
    'short_name', new.short_name,
    'company_type', new.company_type,
    'haulier_id', new.haulier_id,
    'forwarding_agent_id', new.forwarding_agent_id,
    'port_id', new.port_id,
    'depot_id', new.depot_id,
    'assigned_port_ids', coalesce(new.details -> 'assigned_port_ids', '[]'::jsonb),
    'ledger_codes', new.ledger_codes,
    'assigned_depot_ids', coalesce(new.details -> 'assigned_depot_ids', '[]'::jsonb),
    'block', new.block,
    'address1', new.address1,
    'address2', new.address2,
    'city', new.city,
    'state', new.state,
    'postcode', new.postcode,
    'country', new.country,
    'contact_name', new.contact_name,
    'contact_email', new.contact_email,
    'contact_designation', new.contact_designation,
    'contact_mobile', new.contact_mobile,
    'office_phone', new.office_phone,
    'fax', new.fax
  );

  update public.registration_submissions
  set company_reg_no = v_registration_number,
      company_name = new.name,
      company_type = new.company_type,
      data = jsonb_set(
        coalesce(data, '{}'::jsonb),
        '{company}',
        (case when jsonb_typeof(data -> 'company') = 'object'
          then data -> 'company' else '{}'::jsonb end) || v_company_data,
        true
      )
  where company_id = new.id
    and (
      company_reg_no is distinct from v_registration_number
      or company_name is distinct from new.name
      or company_type is distinct from new.company_type
      or data -> 'company' is distinct from
        (case when jsonb_typeof(data -> 'company') = 'object'
          then data -> 'company' else '{}'::jsonb end) || v_company_data
    );

  update public.user_registrations
  set company_name = new.name
  where company_id = new.id and company_name is distinct from new.name;

  update public.external_user_access
  set company_name = new.name
  where company_id = new.id and company_name is distinct from new.name;

  return new;
end;
$$;

drop trigger if exists sync_company_details_from_master on public.companies;
create trigger sync_company_details_from_master
after insert or update of
  registration_number, registration_number_old, registration_number_new,
  name, short_name, company_type, haulier_id, forwarding_agent_id,
  port_id, depot_id, details, ledger_codes,
  block, address1, address2, city, state, postcode, country,
  contact_name, contact_email, contact_designation, contact_mobile,
  office_phone, fax
on public.companies
for each row execute function public.sync_company_details_from_master();

-- Repair snapshots that were already out of sync before this migration.
update public.companies set name = name;

revoke all on function public.sync_company_details_from_master() from public, anon, authenticated;
