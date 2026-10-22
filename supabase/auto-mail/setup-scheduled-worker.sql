-- OPTIONAL SETUP, separate Auto Mail project ONLY, after 20261022070000.
-- First add a random >=32-character AUTO_MAIL_SCHEDULER_SECRET to Vercel and redeploy.
-- Use the SAME value below. Never use your Supabase service key as this secret.
-- Replace both placeholders before running; secret is stored in Supabase Vault.
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

select vault.create_secret('REPLACE_WITH_YOUR_AUTO_MAIL_SCHEDULER_SECRET','auto_mail_worker_secret');
select vault.create_secret('https://cargomove-register.vercel.app/api/auto-mail/outbox-run','auto_mail_worker_url');

select cron.schedule('auto-mail-outbox-every-minute','* * * * *',$job$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name='auto_mail_worker_url'),
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' ||
      (select decrypted_secret from vault.decrypted_secrets where name='auto_mail_worker_secret')),
    body := '{}'::jsonb,
    timeout_milliseconds := 55000
  );
$job$);

-- One message is claimed per minute. Other cron ticks cannot claim the same row.
-- Check: select last_seen from auto_mail.outbox_worker_state;
-- Pause: select cron.unschedule('auto-mail-outbox-every-minute');
-- For key rotation, update the named Vault secret instead of creating a duplicate.
