-- Milestone 9: read-only metrics for a case-created-at cohort. No external calls.
begin;
create function public.support_analytics(p_from timestamptz default null,p_to timestamptz default null) returns jsonb
language sql stable set search_path=pg_catalog,public as $$
 with cases as (
  select * from public.support_cases where (p_from is null or created_at>=p_from) and (p_to is null or created_at<p_to)
 ), analyses as (
  select a.* from public.ai_interactions a join cases c on c.id=a.case_id where a.analysis_key is not null
 ), drafts as (
  select r.* from public.support_reply_drafts r join cases c on c.id=r.case_id
 ), sent as (
  select d.*,r.interaction_id,r.template_id from public.support_reply_deliveries d join drafts r on r.id=d.draft_id where d.kind='SEND' and d.status='DONE'
 ), approved as (
  select distinct a.* from public.ai_interactions a join sent s on s.interaction_id=a.id where s.template_id='KNOWLEDGE' and a.approved_by is not null and a.final_reply is not null
 ), response as (
  select c.id,inbound.sent_at as received_at,outbound.sent_at as replied_at,
   extract(epoch from outbound.sent_at-inbound.sent_at) as seconds
  from cases c left join lateral (
   select sent_at from public.support_messages where case_id=c.id and direction='INBOUND' order by sent_at,id limit 1
  )inbound on true left join lateral (
   select sent_at from public.support_messages where case_id=c.id and direction='OUTBOUND' and sent_at>=inbound.sent_at order by sent_at,id limit 1
  )outbound on true
 ), usage as (
  select distinct r.interaction_id,kid.id from drafts r join public.ai_interactions a on a.id=r.interaction_id cross join lateral unnest(a.knowledge_ids) kid(id)
 ), knowledge_usage as (
  select u.id,k.knowledge_code,k.title,k.active,count(*) as drafts,
   count(*) filter(where exists(select 1 from sent s where s.interaction_id=u.interaction_id)) as sent_replies
  from usage u join public.support_knowledge k on k.id=u.id group by u.id,k.knowledge_code,k.title,k.active order by count(*) desc,k.knowledge_code,u.id limit 20
 ) select jsonb_build_object(
  'cohort',jsonb_build_object('from',p_from,'to_exclusive',p_to),
  'cases',jsonb_build_object('total',(select count(*) from cases),'new',(select count(*) from cases where status='NEW'),
   'open',(select count(*) from cases where status<>'RESOLVED'),'resolved',(select count(*) from cases where status='RESOLVED'),
   'escalated',(select count(*) from cases where status='ESCALATED'),
   'escalation_events',(select count(*) from public.support_case_events e join cases c on c.id=e.case_id where e.action='ESCALATE')),
  'ai',jsonb_build_object('classifications',(select count(*) from analyses),'suggested_drafts',(select count(*) from drafts),
   'knowledge_drafts',(select count(*) from drafts where template_id='KNOWLEDGE'),
   'static_drafts',(select count(*) from drafts where template_id<>'KNOWLEDGE'),
   'approved_unchanged',(select count(*) from approved where was_edited=false),
   'approved_edited',(select count(*) from approved where was_edited=true),
   'approved_unknown_comparison',(select count(*) from approved where was_edited is null),
   'confirmed_sends',(select count(*) from sent),
   'classification_corrections',null),
  'response',jsonb_build_object('average_seconds',(select avg(seconds) from response where replied_at is not null),
   'median_seconds',(select percentile_cont(0.5) within group(order by seconds) from response where replied_at is not null),
   'sample_cases',(select count(*) from response where replied_at is not null),
   'awaiting_first_response',(select count(*) from response where received_at is not null and replied_at is null),
   'without_inbound',(select count(*) from response where received_at is null)),
  'categories',coalesce((select jsonb_agg(to_jsonb(t) order by count desc,name) from(select category as name,count(*) as count from cases group by category)t),'[]'::jsonb),
  'subcategories',coalesce((select jsonb_agg(to_jsonb(t) order by count desc,name) from(select coalesce(subcategory,'UNCLASSIFIED') as name,count(*) as count from cases group by subcategory)t),'[]'::jsonb),
  'ports',coalesce((select jsonb_agg(to_jsonb(t) order by count desc,name) from(select port as name,count(*) as count from cases group by port)t),'[]'::jsonb),
  'daily_cases',coalesce((select jsonb_agg(to_jsonb(t) order by day) from(select to_char(created_at at time zone 'UTC','YYYY-MM-DD') as day,count(*) as count from cases group by 1)t),'[]'::jsonb),
  'knowledge_usage',coalesce((select jsonb_agg(to_jsonb(t) order by drafts desc,knowledge_code,id) from knowledge_usage t),'[]'::jsonb)
 );
$$;
revoke all on function public.support_analytics(timestamptz,timestamptz) from public,anon,authenticated;
grant execute on function public.support_analytics(timestamptz,timestamptz) to service_role;
commit;
