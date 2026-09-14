-- Preserve email audit history when an administrator removes a reusable template.
-- The log already stores the template name and version used for each send.

alter table public.email_logs
  drop constraint if exists email_logs_template_id_fkey;

alter table public.email_logs
  add constraint email_logs_template_id_fkey
  foreign key (template_id) references public.email_templates(id) on delete set null;
