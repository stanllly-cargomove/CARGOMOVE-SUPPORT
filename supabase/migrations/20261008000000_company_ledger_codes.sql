-- Ledger codes are exported in the same order as a company's assigned ports.
alter table public.companies
  add column if not exists ledger_codes text;
