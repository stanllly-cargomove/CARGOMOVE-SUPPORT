-- Preserve generated Excel metadata and internal review notes on submissions.
-- IF NOT EXISTS keeps this safe for databases created from the latest init migration.
alter table public.registration_submissions
  add column if not exists exported_at timestamptz,
  add column if not exists export_filename text,
  add column if not exists admin_notes text;

comment on column public.registration_submissions.exported_at is
  'UTC date and time when the latest Excel file was generated.';

comment on column public.registration_submissions.export_filename is
  'Filename of the latest generated Excel export.';

comment on column public.registration_submissions.admin_notes is
  'Internal notes recorded by an administrator during submission review.';

create index if not exists registration_submissions_exported_at_idx
  on public.registration_submissions (exported_at desc)
  where exported_at is not null;
