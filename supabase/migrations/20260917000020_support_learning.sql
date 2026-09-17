-- Milestone 8: deterministic correction proposals; only a human can change knowledge.
begin;
alter table public.support_learning_suggestions
 add column correction_key text unique,
 add column updated_at timestamptz not null default now(),
 add column knowledge_version timestamptz,
 add column approved_knowledge_id uuid references public.support_knowledge(id) on delete restrict,
 add column approved_article jsonb check(approved_article is null or jsonb_typeof(approved_article)='object');
create trigger support_learning_touch_updated_at before update on public.support_learning_suggestions for each row execute function public.touch_updated_at();
create table public.support_learning_evidence (
 suggestion_id uuid not null references public.support_learning_suggestions(id) on delete restrict,
 interaction_id uuid not null references public.ai_interactions(id) on delete restrict,
 case_id uuid not null references public.support_cases(id) on delete restrict,
 primary key(suggestion_id,case_id),unique(suggestion_id,interaction_id)
);
alter table public.support_learning_evidence enable row level security;
revoke all on public.support_learning_evidence from public,anon,authenticated;
grant select,insert,update,delete on public.support_learning_evidence to service_role;
-- Exact normalized final wording, taxonomy and a single shared source determine a group.
-- Multi-source replies produce new-article suggestions rather than guessing which source is wrong.
create function public.detect_support_learning() returns jsonb language plpgsql set search_path=pg_catalog,public as $$
declare g record; sid uuid; added integer:=0;
begin
 perform pg_advisory_xact_lock(80316008);
 for g in
  with corrections as (
   select a.*,d.case_id as evidence_case,case when cardinality(a.knowledge_ids)=1 then a.knowledge_ids[1] end as source_id,
    lower(regexp_replace(btrim(a.final_reply),'[[:space:]]+',' ','g')) as normalized
   from public.support_reply_deliveries d join public.support_reply_drafts r on r.id=d.draft_id join public.ai_interactions a on a.id=r.interaction_id
   where d.kind='SEND' and d.status='DONE' and a.approved_by is not null and a.was_edited=true
    and a.final_reply=d.reply_text and a.generated_reply is not null
    and lower(regexp_replace(btrim(a.generated_reply),'[[:space:]]+',' ','g'))<>lower(regexp_replace(btrim(a.final_reply),'[[:space:]]+',' ','g'))
  ), grouped as (
   select category,subcategory,port,source_id,normalized,count(distinct evidence_case) as n,
    (array_agg(final_reply order by created_at desc,id desc))[1] as resolution,
    array_agg(id order by created_at desc,id desc) as interactions
   from corrections group by category,subcategory,port,source_id,normalized having count(distinct evidence_case)>=3
  ) select *,md5(jsonb_build_array(category,subcategory,port,source_id,normalized)::text) as key from grouped
 loop
  select id into sid from public.support_learning_suggestions where correction_key=g.key;
  if sid is null then
   insert into public.support_learning_suggestions(category,subcategory,port,existing_knowledge_id,knowledge_version,suggested_problem,suggested_resolution,suggested_action,evidence_count,correction_key)
   values(g.category,g.subcategory,g.port,g.source_id,(select updated_at from public.support_knowledge where id=g.source_id),
    'Repeated staff correction for '||coalesce(g.subcategory,g.category),g.resolution,'Review evidence and remove customer-specific details before approving.',g.n,g.key) returning id into sid;
   added:=added+1;
  end if;
  -- Reviewed proposals and their evidence remain immutable. Rejected groups do not recur.
  perform id from public.support_learning_suggestions where id=sid for update;
  if exists(select 1 from public.support_learning_suggestions where id=sid and status='PENDING') then
   insert into public.support_learning_evidence(suggestion_id,interaction_id,case_id)
   select sid,a.id,a.case_id from public.ai_interactions a where a.id=any(g.interactions)
   order by a.created_at desc,a.id desc on conflict(suggestion_id,case_id) do nothing;
   update public.support_learning_suggestions set evidence_count=(select count(*) from public.support_learning_evidence where suggestion_id=sid)
   where id=sid and evidence_count is distinct from (select count(*) from public.support_learning_evidence where suggestion_id=sid);
  end if;
 end loop;
 return jsonb_build_object('created',added);
end;$$;
create function public.list_support_learning(p_status text default 'PENDING',p_offset integer default 0) returns jsonb language sql stable set search_path=pg_catalog,public as $$
 select jsonb_build_object('suggestions',coalesce((select jsonb_agg(to_jsonb(s) order by created_at desc,id desc) from (
 select * from public.support_learning_suggestions where status=p_status order by created_at desc,id desc limit 20 offset greatest(0,least(100000,p_offset))
 )s),'[]'::jsonb),'total',(select count(*) from public.support_learning_suggestions where status=p_status));
$$;
create function public.get_support_learning(p_id uuid) returns jsonb language sql stable set search_path=pg_catalog,public as $$
 select jsonb_build_object('suggestion',to_jsonb(s),'knowledge',(select to_jsonb(k) from public.support_knowledge k where k.id=s.existing_knowledge_id),
 'evidence',coalesce((select jsonb_agg(to_jsonb(t) order by approved_at desc,interaction_id desc) from (
 select e.case_id,e.interaction_id,a.generated_reply,a.final_reply,a.approved_by,a.approved_at from public.support_learning_evidence e join public.ai_interactions a on a.id=e.interaction_id where e.suggestion_id=s.id order by a.approved_at desc,e.interaction_id desc limit 20
 )t),'[]'::jsonb)) from public.support_learning_suggestions s where s.id=p_id;
$$;
create function public.review_support_learning(p_id uuid,p_expected timestamptz,p_approve boolean,p_article jsonb,p_admin uuid) returns jsonb language plpgsql set search_path=pg_catalog,public as $$
declare s public.support_learning_suggestions; article jsonb;
begin
 select * into s from public.support_learning_suggestions where id=p_id for update;
 if not found then return jsonb_build_object('error','NOT_FOUND'); end if;
 if s.status<>'PENDING' or s.updated_at is distinct from p_expected then return jsonb_build_object('error','CONFLICT'); end if;
 if p_approve then
  if s.evidence_count<3 then return jsonb_build_object('error','INSUFFICIENT_EVIDENCE'); end if;
  -- Keep safety flags under human control; the server validates the complete article.
  article:=public.save_support_knowledge(s.existing_knowledge_id,s.knowledge_version,p_article,p_admin);
  if article ? 'error' then return article; end if;
  update public.support_learning_suggestions set status='APPROVED',reviewed_by=p_admin,reviewed_at=clock_timestamp(),approved_knowledge_id=(article->>'id')::uuid,approved_article=article where id=p_id;
 else
  update public.support_learning_suggestions set status='REJECTED',reviewed_by=p_admin,reviewed_at=clock_timestamp() where id=p_id;
 end if;
 return jsonb_build_object('article',article,'suggestion',(select to_jsonb(x) from public.support_learning_suggestions x where x.id=p_id));
end;$$;
revoke all on function public.detect_support_learning(),public.list_support_learning(text,integer),public.get_support_learning(uuid),public.review_support_learning(uuid,timestamptz,boolean,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.detect_support_learning(),public.list_support_learning(text,integer),public.get_support_learning(uuid),public.review_support_learning(uuid,timestamptz,boolean,jsonb,uuid) to service_role;
commit;
