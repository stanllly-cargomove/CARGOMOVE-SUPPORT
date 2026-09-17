-- Milestone 6 only: suggested replies and editable drafts, never Gmail writes.
begin;
create table public.support_reply_drafts (
 id uuid primary key default gen_random_uuid(),
 case_id uuid not null references public.support_cases(id) on delete restrict,
 source_analysis_id uuid not null references public.ai_interactions(id) on delete restrict,
 interaction_id uuid not null unique references public.ai_interactions(id) on delete restrict,
 generation_key text not null unique,
 template_id text not null check(template_id in ('KNOWLEDGE','ACKNOWLEDGE','REQUEST_DETAILS')),
 context_fingerprint text not null,
 knowledge_versions jsonb not null check(jsonb_typeof(knowledge_versions)='object'),
 edited_reply text not null check(length(btrim(edited_reply)) between 1 and 6000),
 created_by uuid not null references auth.users(id) on delete restrict,
 updated_by uuid not null references auth.users(id) on delete restrict,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create index support_reply_case_created_idx on public.support_reply_drafts(case_id,created_at desc,id desc);
create trigger support_reply_touch_updated_at before update on public.support_reply_drafts for each row execute function public.touch_updated_at();
create table public.support_reply_generation_state (
 case_id uuid primary key references public.support_cases(id) on delete restrict,
 token uuid,expires_at timestamptz,case_version timestamptz,source_analysis_id uuid references public.ai_interactions(id) on delete restrict,
 context_fingerprint text,knowledge_versions jsonb,template_id text,model text,prompt_version text,generation_key text,
 requested_by uuid references auth.users(id) on delete restrict,
 check((token is null)=(expires_at is null))
);
alter table public.support_reply_drafts enable row level security;
alter table public.support_reply_generation_state enable row level security;
revoke all on public.support_reply_drafts,public.support_reply_generation_state from public,anon,authenticated;
grant select,insert,update,delete on public.support_reply_drafts,public.support_reply_generation_state to service_role;

create function public.claim_support_reply(p_id uuid,p_template text,p_model text,p_version text,p_token uuid,p_admin uuid) returns jsonb
language plpgsql set search_path=pg_catalog,public as $$
declare c public.support_cases; source public.ai_interactions; s public.support_reply_generation_state; articles jsonb; versions jsonb; fingerprint text; key text; cached uuid;
begin
 select * into c from public.support_cases where id=p_id for update;
 if not found then return jsonb_build_object('error','NOT_FOUND'); end if;
 if c.status='RESOLVED' then return jsonb_build_object('error','RESOLVED'); end if;
 if p_template not in ('KNOWLEDGE','ACKNOWLEDGE','REQUEST_DETAILS') then return jsonb_build_object('error','INVALID_TEMPLATE'); end if;
 select * into source from public.ai_interactions where case_id=p_id and analysis_key is not null order by created_at desc,id desc limit 1;
 if not found then return jsonb_build_object('error','NO_ANALYSIS'); end if;
 if (public.get_support_analysis(p_id)->>'stale')::boolean then return jsonb_build_object('error','STALE'); end if;
 select coalesce(jsonb_agg(k order by k->>'id'),'[]'::jsonb),coalesce(jsonb_object_agg(k->>'id',k->>'updated_at'),'{}'::jsonb) into articles,versions
 from jsonb_array_elements(public.match_support_knowledge(p_id)->'articles')k where (k->>'ai_reply_allowed')::boolean and p_template='KNOWLEDGE';
 if p_template='KNOWLEDGE' and jsonb_array_length(articles)=0 then return jsonb_build_object('error','NO_KNOWLEDGE'); end if;
 fingerprint:=md5(public.support_analysis_snapshot(p_id)::text);
 key:=md5(jsonb_build_array(p_id,source.id,p_template,p_model,p_version,fingerprint,versions)::text);
 select id into cached from public.support_reply_drafts where generation_key=key;
 if cached is not null then return jsonb_build_object('cached_id',cached); end if;
 insert into public.support_reply_generation_state(case_id)values(p_id)on conflict do nothing;
 select * into s from public.support_reply_generation_state where case_id=p_id for update;
 if s.token is not null and s.expires_at>clock_timestamp() then return jsonb_build_object('error','BUSY'); end if;
 update public.support_reply_generation_state set token=p_token,expires_at=clock_timestamp()+interval '60 seconds',case_version=c.updated_at,
 source_analysis_id=source.id,context_fingerprint=fingerprint,knowledge_versions=versions,template_id=p_template,model=p_model,prompt_version=p_version,generation_key=key,requested_by=p_admin where case_id=p_id;
 return jsonb_build_object('analysis',to_jsonb(source),'snapshot',public.support_analysis_snapshot(p_id),'articles',articles);
end;$$;
create function public.complete_support_reply(p_id uuid,p_token uuid,p_text text,p_knowledge_ids uuid[]) returns jsonb
language plpgsql set search_path=pg_catalog,public as $$
declare c public.support_cases; s public.support_reply_generation_state; source public.ai_interactions; interaction uuid; draft uuid; selected_versions jsonb;
begin
 select * into c from public.support_cases where id=p_id for update;
 select * into s from public.support_reply_generation_state where case_id=p_id for update;
 if s.token is distinct from p_token or s.expires_at<=clock_timestamp() then return jsonb_build_object('error','STALE'); end if;
 if c.status='RESOLVED' or c.updated_at is distinct from s.case_version or md5(public.support_analysis_snapshot(p_id)::text)<>s.context_fingerprint
 or s.source_analysis_id is distinct from (public.get_support_analysis(p_id)->'interaction'->>'id')::uuid then return jsonb_build_object('error','STALE'); end if;
 -- Lock supplied articles against concurrent edits/deactivation through commit.
 perform id from public.support_knowledge where id::text in (select jsonb_object_keys(s.knowledge_versions)) order by id for share;
 if exists(select 1 from jsonb_each_text(s.knowledge_versions)v left join public.support_knowledge k on k.id::text=v.key
 where k.id is null or not k.active or not k.ai_reply_allowed or k.updated_at is distinct from v.value::timestamptz) then return jsonb_build_object('error','STALE_KNOWLEDGE'); end if;
 if p_knowledge_ids is null or exists(select 1 from unnest(p_knowledge_ids)x where x is null or not s.knowledge_versions ? x::text)
 or cardinality(p_knowledge_ids)<>(select count(distinct x) from unnest(p_knowledge_ids)x)
 or (s.template_id='KNOWLEDGE' and cardinality(p_knowledge_ids)=0)
 or (s.template_id<>'KNOWLEDGE' and cardinality(p_knowledge_ids)>0) then return jsonb_build_object('error','INVALID_SOURCES'); end if;
 select * into source from public.ai_interactions where id=s.source_analysis_id;
 insert into public.ai_interactions(case_id,message_id,model,prompt_version,category,subcategory,port,language,urgency,confidence,entities,short_explanation,recommended_action,requires_human_review,knowledge_ids,generated_reply,requested_by)
 values(p_id,source.message_id,s.model,s.prompt_version,source.category,source.subcategory,source.port,source.language,source.urgency,source.confidence,source.entities,source.short_explanation,source.recommended_action,true,p_knowledge_ids,p_text,s.requested_by) returning id into interaction;
 select coalesce(jsonb_object_agg(v.key,v.value),'{}'::jsonb) into selected_versions from jsonb_each(s.knowledge_versions)v where v.key::uuid=any(p_knowledge_ids);
 insert into public.support_reply_drafts(case_id,source_analysis_id,interaction_id,generation_key,template_id,context_fingerprint,knowledge_versions,edited_reply,created_by,updated_by)
 values(p_id,source.id,interaction,s.generation_key,s.template_id,s.context_fingerprint,selected_versions,p_text,s.requested_by,s.requested_by) returning id into draft;
 update public.support_cases set status=case when status='ESCALATED' then 'ESCALATED' else 'NEEDS_REVIEW' end where id=p_id;
 update public.support_reply_generation_state set token=null,expires_at=null where case_id=p_id;
 return jsonb_build_object('draft_id',draft);
end;$$;
create function public.release_support_reply(p_id uuid,p_token uuid)returns void language sql set search_path=pg_catalog,public as $$
 update public.support_reply_generation_state set token=null,expires_at=null where case_id=p_id and token=p_token;
$$;
create function public.get_support_reply(p_case uuid,p_draft uuid default null)returns jsonb language sql stable set search_path=pg_catalog,public as $$
 select jsonb_build_object('draft', (select to_jsonb(d)||jsonb_build_object('interaction',to_jsonb(a),
 'stale',c.status='RESOLVED' or d.context_fingerprint<>md5(public.support_analysis_snapshot(c.id)::text)
 or d.source_analysis_id is distinct from (public.get_support_analysis(c.id)->'interaction'->>'id')::uuid
 or exists(select 1 from jsonb_each_text(d.knowledge_versions)v left join public.support_knowledge k on k.id::text=v.key where k.id is null or not k.active or not k.ai_reply_allowed or k.updated_at is distinct from v.value::timestamptz),
 'knowledge',coalesce((select jsonb_agg(to_jsonb(k) order by knowledge_code)from public.support_knowledge k where k.id=any(a.knowledge_ids)),'[]'::jsonb))
 from public.support_reply_drafts d join public.ai_interactions a on a.id=d.interaction_id where d.case_id=c.id and (p_draft is null or d.id=p_draft) order by d.created_at desc,d.id desc limit 1))
 from public.support_cases c where id=p_case;
$$;
create function public.edit_support_reply(p_id uuid,p_expected timestamptz,p_text text,p_admin uuid)returns jsonb language plpgsql set search_path=pg_catalog,public as $$
declare d public.support_reply_drafts; c public.support_cases;
begin
 select * into d from public.support_reply_drafts where id=p_id;
 if not found then return jsonb_build_object('error','NOT_FOUND'); end if;
 select * into c from public.support_cases where id=d.case_id for update;
 select * into d from public.support_reply_drafts where id=p_id for update;
 if d.updated_at is distinct from p_expected then return jsonb_build_object('error','CONFLICT'); end if;
 if (public.get_support_reply(d.case_id,d.id)->'draft'->>'stale')::boolean then return jsonb_build_object('error','STALE'); end if;
 update public.support_reply_drafts set edited_reply=p_text,updated_by=p_admin where id=p_id;
 return public.get_support_reply(d.case_id,d.id);
end;$$;
revoke all on function public.claim_support_reply(uuid,text,text,text,uuid,uuid),public.complete_support_reply(uuid,uuid,text,uuid[]),public.release_support_reply(uuid,uuid),public.get_support_reply(uuid,uuid),public.edit_support_reply(uuid,timestamptz,text,uuid) from public,anon,authenticated;
grant execute on function public.claim_support_reply(uuid,text,text,text,uuid,uuid),public.complete_support_reply(uuid,uuid,text,uuid[]),public.release_support_reply(uuid,uuid),public.get_support_reply(uuid,uuid),public.edit_support_reply(uuid,timestamptz,text,uuid) to service_role;
commit;
