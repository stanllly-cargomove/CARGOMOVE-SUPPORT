-- OPTIONAL, separate Auto Mail project ONLY, after 20261023010000_incoming_ai_workflow.sql.
-- Requires the existing outbox cron setup and its auto_mail_worker_secret Vault entry.
-- The incoming agent remains disabled until enabled in Email Config.
select vault.create_secret('https://cargomove-register.vercel.app/api/auto-mail/incoming-ai-run','auto_mail_incoming_worker_url');
select cron.schedule('auto-mail-incoming-drafts-every-minute','* * * * *',$job$
 select net.http_post(
  url := (select decrypted_secret from vault.decrypted_secrets where name='auto_mail_incoming_worker_url'),
  headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' ||
   (select decrypted_secret from vault.decrypted_secrets where name='auto_mail_worker_secret')),
  body := '{}'::jsonb,timeout_milliseconds := 110000
 );
$job$);
-- Check: select last_seen,lease_until from auto_mail.incoming_worker_state;
-- Pause: select cron.unschedule('auto-mail-incoming-drafts-every-minute');
-- No Gmail Send endpoint is called by this worker.
