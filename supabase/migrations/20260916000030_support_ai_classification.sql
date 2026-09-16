-- Milestone 4: classification only. No replies, knowledge edits, or sending.
begin;
alter table public.ai_interactions add column analysis_key text unique;
alter table public.ai_interactions add column requested_by uuid references auth.users(id) on delete restrict;
create table public.support_ai_analysis_state (
 case_id uuid primary key references public.support_cases(id) on delete restrict,
 token uuid, expires_at timestamptz, case_version timestamptz,
 fingerprint text, model text, prompt_version text, message_id uuid,
 requested_by uuid references auth.users(id) on delete restrict,
 check ((token is null) = (expires_at is null))
);
alter table public.support_ai_analysis_state enable row level security;
revoke all on public.support_ai_analysis_state from public,anon,authenticated;
grant select,insert,update,delete on public.support_ai_analysis_state to service_role;

create function public.support_analysis_snapshot(p_id uuid) returns jsonb
language sql stable set search_path = pg_catalog,public as $$
 select jsonb_build_object('subject',c.subject,'messages',coalesce((select jsonb_agg(to_jsonb(m) order by sent_at,id) from (
   select id,direction,body_text,sent_at from public.support_messages where case_id=c.id order by sent_at desc,id desc limit 6
 ) m),'[]'::jsonb),'message_id',(select id from public.support_messages where case_id=c.id and direction='INBOUND' order by sent_at desc,id desc limit 1))
 from public.support_cases c where c.id=p_id;
$$;
create function public.claim_support_analysis(p_id uuid,p_model text,p_version text,p_token uuid,p_admin uuid) returns jsonb
language plpgsql set search_path = pg_catalog,public as $$
declare c public.support_cases; s public.support_ai_analysis_state; snapshot jsonb; v_fingerprint text; cached jsonb;
begin
 select * into c from public.support_cases where id=p_id for update;
 if not found then return jsonb_build_object('error','NOT_FOUND'); end if;
 if c.status='RESOLVED' then return jsonb_build_object('error','RESOLVED'); end if;
 snapshot:=public.support_analysis_snapshot(p_id);
 if snapshot->>'message_id' is null then return jsonb_build_object('error','NO_MESSAGE'); end if;
 v_fingerprint:=md5(snapshot::text);
 select to_jsonb(a) into cached from public.ai_interactions a where a.analysis_key=md5(p_id::text||v_fingerprint||'|'||p_model||'|'||p_version);
 if cached is not null then return jsonb_build_object('cached',cached); end if;
 insert into public.support_ai_analysis_state(case_id) values(p_id) on conflict do nothing;
 select * into s from public.support_ai_analysis_state where case_id=p_id for update;
 if s.token is not null and s.expires_at>clock_timestamp() then return jsonb_build_object('error','BUSY'); end if;
 update public.support_ai_analysis_state set token=p_token,expires_at=clock_timestamp()+interval '60 seconds',case_version=c.updated_at,
   fingerprint=v_fingerprint,model=p_model,prompt_version=p_version,message_id=(snapshot->>'message_id')::uuid,requested_by=p_admin where case_id=p_id;
 return snapshot;
end;$$;
create function public.complete_support_analysis(p_id uuid,p_token uuid,p_result jsonb) returns jsonb
language plpgsql set search_path = pg_catalog,public as $$
declare c public.support_cases; s public.support_ai_analysis_state; interaction public.ai_interactions;
begin
 select * into c from public.support_cases where id=p_id for update;
 select * into s from public.support_ai_analysis_state where case_id=p_id for update;
 if s.token is distinct from p_token or s.expires_at<=clock_timestamp() then return jsonb_build_object('error','STALE'); end if;
 if c.status='RESOLVED' or c.updated_at is distinct from s.case_version or md5(public.support_analysis_snapshot(p_id)::text)<>s.fingerprint then
   update public.support_ai_analysis_state set token=null,expires_at=null where case_id=p_id;
   return jsonb_build_object('error','STALE');
 end if;
 insert into public.ai_interactions(case_id,message_id,model,prompt_version,category,subcategory,port,language,urgency,confidence,entities,
 short_explanation,recommended_action,requires_human_review,analysis_key,requested_by)
 values(p_id,s.message_id,s.model,s.prompt_version,p_result->>'category',p_result->>'subcategory',p_result->>'port',p_result->>'language',p_result->>'urgency',
 (p_result->>'confidence')::numeric,p_result->'entities',p_result->>'short_explanation',p_result->>'recommended_action',true,
 md5(p_id::text||s.fingerprint||'|'||s.model||'|'||s.prompt_version),s.requested_by) returning * into interaction;
 update public.support_cases set category=interaction.category,subcategory=interaction.subcategory,port=interaction.port,urgency=interaction.urgency,
 ai_confidence=interaction.confidence,status=case when status='ESCALATED' then 'ESCALATED' else 'NEEDS_REVIEW' end where id=p_id;
 update public.support_ai_analysis_state set token=null,expires_at=null where case_id=p_id;
 return to_jsonb(interaction);
end;$$;
create function public.release_support_analysis(p_id uuid,p_token uuid) returns void language sql set search_path=pg_catalog,public as $$
 update public.support_ai_analysis_state set token=null,expires_at=null where case_id=p_id and token=p_token;
$$;
create function public.get_support_analysis(p_id uuid) returns jsonb language sql stable set search_path=pg_catalog,public as $$
 select jsonb_build_object('interaction',(select to_jsonb(a) from public.ai_interactions a where a.case_id=c.id and a.analysis_key is not null order by a.created_at desc,a.id desc limit 1),
 'stale',coalesce((select a.analysis_key<>md5(c.id::text||md5(public.support_analysis_snapshot(c.id)::text)||'|'||a.model||'|'||a.prompt_version)
 from public.ai_interactions a where a.case_id=c.id and a.analysis_key is not null order by a.created_at desc,a.id desc limit 1),false)) from public.support_cases c where id=p_id;
$$;
revoke all on function public.support_analysis_snapshot(uuid),public.claim_support_analysis(uuid,text,text,uuid,uuid),public.complete_support_analysis(uuid,uuid,jsonb),public.release_support_analysis(uuid,uuid),public.get_support_analysis(uuid) from public,anon,authenticated;
grant execute on function public.support_analysis_snapshot(uuid),public.claim_support_analysis(uuid,text,text,uuid,uuid),public.complete_support_analysis(uuid,uuid,jsonb),public.release_support_analysis(uuid,uuid),public.get_support_analysis(uuid) to service_role;
commit;
