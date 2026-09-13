-- Promote frequently queried company and contact fields out of details JSONB.
alter table public.companies
  add column if not exists block text,
  add column if not exists address1 text,
  add column if not exists address2 text,
  add column if not exists city text,
  add column if not exists state text,
  add column if not exists postcode text,
  add column if not exists country text,
  add column if not exists contact_name text,
  add column if not exists contact_email text,
  add column if not exists contact_designation text,
  add column if not exists contact_mobile text,
  add column if not exists office_phone text,
  add column if not exists fax text;

update public.companies
set
  block = coalesce(block, details->>'block'),
  address1 = coalesce(address1, details->>'address1'),
  address2 = coalesce(address2, details->>'address2'),
  city = coalesce(city, details->>'city'),
  state = coalesce(state, details->>'state'),
  postcode = coalesce(postcode, details->>'postcode'),
  country = coalesce(country, details->>'country'),
  contact_name = coalesce(contact_name, details->>'contact_name'),
  contact_email = coalesce(contact_email, details->>'contact_email'),
  contact_designation = coalesce(contact_designation, details->>'contact_designation'),
  contact_mobile = coalesce(contact_mobile, details->>'contact_mobile'),
  office_phone = coalesce(office_phone, details->>'office_phone'),
  fax = coalesce(fax, details->>'fax')
where details is not null;
