-- Normalize legacy company-registration identifiers. This changes only letter
-- casing; numbers, hyphens, company IDs, and all relationships are preserved.

begin;

update public.companies
set
  registration_number = upper(registration_number),
  registration_number_old = upper(registration_number_old)
where registration_number is distinct from upper(registration_number)
   or registration_number_old is distinct from upper(registration_number_old);

-- Keep the registration submission's denormalized company identifier and its
-- original submitted company payload consistent with Company Master.
update public.registration_submissions
set
  company_reg_no = upper(company_reg_no),
  data = case
    when jsonb_typeof(data -> 'company') = 'object'
      and (data -> 'company') ? 'registration_number_old'
    then jsonb_set(
      data,
      '{company,registration_number_old}',
      to_jsonb(upper(data #>> '{company,registration_number_old}'))
    )
    else data
  end
where company_reg_no is distinct from upper(company_reg_no)
   or (
     jsonb_typeof(data -> 'company') = 'object'
     and (data -> 'company') ? 'registration_number_old'
     and data #>> '{company,registration_number_old}' is distinct from upper(data #>> '{company,registration_number_old}')
   );

commit;
