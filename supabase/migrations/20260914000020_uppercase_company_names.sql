-- Keep company names consistent across the Operations Center data sources.

update public.companies
set name = upper(btrim(name))
where name is distinct from upper(btrim(name));

update public.registration_submissions
set company_name = upper(btrim(company_name))
where company_name is distinct from upper(btrim(company_name));

update public.user_registrations
set company_name = upper(btrim(company_name))
where company_name is distinct from upper(btrim(company_name));

update public.external_user_access
set company_name = upper(btrim(company_name))
where company_name is distinct from upper(btrim(company_name));

update public.registration_tracking
set company_name = upper(btrim(company_name))
where company_name is distinct from upper(btrim(company_name));

create or replace function public.normalize_company_name()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_table_name = 'companies' then
    new.name := upper(btrim(new.name));
  else
    new.company_name := upper(btrim(new.company_name));
  end if;
  return new;
end;
$$;

drop trigger if exists normalize_company_name on public.companies;
create trigger normalize_company_name
before insert or update of name on public.companies
for each row execute function public.normalize_company_name();

drop trigger if exists normalize_company_name on public.registration_submissions;
create trigger normalize_company_name
before insert or update of company_name on public.registration_submissions
for each row execute function public.normalize_company_name();

drop trigger if exists normalize_company_name on public.user_registrations;
create trigger normalize_company_name
before insert or update of company_name on public.user_registrations
for each row execute function public.normalize_company_name();

drop trigger if exists normalize_company_name on public.external_user_access;
create trigger normalize_company_name
before insert or update of company_name on public.external_user_access
for each row execute function public.normalize_company_name();

drop trigger if exists normalize_company_name on public.registration_tracking;
create trigger normalize_company_name
before insert or update of company_name on public.registration_tracking
for each row execute function public.normalize_company_name();
