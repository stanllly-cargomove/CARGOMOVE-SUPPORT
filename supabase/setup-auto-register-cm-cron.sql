-- Run only in the MAIN application Supabase SQL Editor, AFTER deploying the
-- signed-request handler and applying migration 20261026050000.
-- First use Supabase Vault to create:
--   auto_register_cm_url = production HTTPS /api/scheduler/auto-register-cm URL
--   auto_register_cm_cron_secret = the existing Vercel CRON_SECRET value
-- Never put either actual value into this file or source control.
begin;
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;
create extension if not exists pgcrypto with schema extensions;
do $$ begin
  if (select count(*) from vault.decrypted_secrets where name in ('auto_register_cm_url','auto_register_cm_cron_secret'))<>2 then
    raise exception 'Configure the two Auto Register Vault secrets before enabling delivery';
  end if;
end $$;
select cron.schedule('auto-register-cm-delivery','* * * * *','select public.auto_register_cm_cron_tick();');
update public.auto_register_cm_cron_state set is_enabled=true,last_status='READY',last_error_code=null
  where scheduler_key='auto_register_cm';
commit;
-- The job observes the application's existing Enabled toggle. This setup does
-- not turn that toggle on or submit registrations during provisioning.
