-- Remove the retired support/KB auto-email subsystem.
-- Registration email tables, templates, logs, attachments and the shared
-- Gmail OAuth connection are intentionally preserved.
begin;

drop function if exists public.acquire_gmail_sync(text, timestamptz, uuid) cascade;
drop function if exists public.checkpoint_gmail_sync(uuid, jsonb, boolean) cascade;
drop function if exists public.persist_gmail_thread(uuid, text, jsonb) cascade;
drop function if exists public.tracked_gmail_threads(uuid) cascade;
drop function if exists public.release_gmail_sync(uuid) cascade;

drop function if exists public.list_support_cases(jsonb) cascade;
drop function if exists public.get_support_case(uuid, integer) cascade;
drop function if exists public.support_inbox_stats() cascade;
drop function if exists public.support_analysis_snapshot(uuid) cascade;
drop function if exists public.claim_support_analysis(uuid, text, text, uuid, uuid) cascade;
drop function if exists public.complete_support_analysis(uuid, uuid, jsonb) cascade;
drop function if exists public.release_support_analysis(uuid, uuid) cascade;
drop function if exists public.get_support_analysis(uuid) cascade;
drop function if exists public.list_support_knowledge(jsonb) cascade;
drop function if exists public.save_support_knowledge(uuid, timestamptz, jsonb, uuid) cascade;
drop function if exists public.match_support_knowledge(uuid) cascade;
drop function if exists public.claim_support_reply(uuid, text, text, text, uuid, uuid) cascade;
drop function if exists public.complete_support_reply(uuid, uuid, text, uuid[]) cascade;
drop function if exists public.release_support_reply(uuid, uuid) cascade;
drop function if exists public.get_support_reply(uuid, uuid) cascade;
drop function if exists public.edit_support_reply(uuid, timestamptz, text, uuid) cascade;
drop function if exists public.support_delivery_state(uuid) cascade;
drop function if exists public.claim_support_delivery(uuid, timestamptz, timestamptz, text, uuid, uuid, text, text, text) cascade;
drop function if exists public.finish_support_delivery(uuid, text, text, text, timestamptz) cascade;
drop function if exists public.fail_support_delivery(uuid, boolean) cascade;
drop function if exists public.set_support_case_status(uuid, timestamptz, text, text, uuid) cascade;
drop function if exists public.support_delivery_context(uuid) cascade;
drop function if exists public.detect_support_learning() cascade;
drop function if exists public.list_support_learning(text, integer) cascade;
drop function if exists public.get_support_learning(uuid) cascade;
drop function if exists public.review_support_learning(uuid, timestamptz, boolean, jsonb, uuid) cascade;
drop function if exists public.support_analytics(timestamptz, timestamptz) cascade;
drop function if exists public.list_support_automation() cascade;
drop function if exists public.save_support_automation(uuid, timestamptz, jsonb, uuid) cascade;
drop function if exists public.support_automation_policy(uuid) cascade;
drop function if exists public.claim_support_auto_ack(uuid, timestamptz, timestamptz, text, uuid, uuid, text, text, text, uuid, timestamptz) cascade;

drop table if exists public.support_automation_rule_events cascade;
drop table if exists public.support_learning_evidence cascade;
drop table if exists public.support_case_events cascade;
drop table if exists public.support_reply_deliveries cascade;
drop table if exists public.support_reply_generation_state cascade;
drop table if exists public.support_reply_drafts cascade;
drop table if exists public.support_ai_analysis_state cascade;
drop table if exists public.gmail_sync_state cascade;
drop table if exists public.support_automation_rules cascade;
drop table if exists public.support_learning_suggestions cascade;
drop table if exists public.ai_interactions cascade;
drop table if exists public.support_knowledge cascade;
drop table if exists public.support_messages cascade;
drop table if exists public.support_cases cascade;

commit;
