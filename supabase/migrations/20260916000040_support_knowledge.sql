-- Milestone 5: human-managed knowledge and classification-based retrieval only.
begin;
create function public.list_support_knowledge(p_filters jsonb default '{}') returns jsonb
language sql stable set search_path=pg_catalog,public as $$
 with filtered as (
 select k.* from public.support_knowledge k
 where (nullif(p_filters->>'category','') is null or k.category=p_filters->>'category')
 and (nullif(p_filters->>'subcategory','') is null or k.subcategory=p_filters->>'subcategory')
 and (nullif(p_filters->>'port','') is null or k.port=p_filters->>'port')
 and (nullif(p_filters->>'active','') is null or k.active=(p_filters->>'active')::boolean)
 and (nullif(p_filters->>'ai_reply_allowed','') is null or k.ai_reply_allowed=(p_filters->>'ai_reply_allowed')::boolean)
 and (nullif(p_filters->>'human_review_required','') is null or k.human_review_required=(p_filters->>'human_review_required')::boolean)
 and (nullif(btrim(p_filters->>'q'),'') is null or strpos(lower(k.knowledge_code||' '||k.title||' '||k.problem||' '||coalesce(k.possible_cause,'')||' '||k.resolution||' '||coalesce(k.suggested_action,'')||' '||array_to_string(k.keywords,' ')),lower(p_filters->>'q'))>0)
 ), page as (select * from filtered order by updated_at desc,id desc limit 20 offset greatest(0,least(100000,coalesce((p_filters->>'offset')::int,0))))
 select jsonb_build_object('articles',coalesce((select jsonb_agg(to_jsonb(p) order by updated_at desc,id desc) from page p),'[]'::jsonb),'total',(select count(*) from filtered));
$$;
-- Optimistic concurrency protects another admin's edits, including activation.
create function public.save_support_knowledge(p_id uuid,p_expected timestamptz,p_article jsonb,p_admin uuid) returns jsonb
language plpgsql set search_path=pg_catalog,public as $$
declare current public.support_knowledge; saved public.support_knowledge;
begin
 if p_id is not null then
  select * into current from public.support_knowledge where id=p_id for update;
  if not found then return jsonb_build_object('error','NOT_FOUND'); end if;
  if p_expected is null or current.updated_at is distinct from p_expected then return jsonb_build_object('error','CONFLICT'); end if;
 end if;
 if p_id is null then
 insert into public.support_knowledge(knowledge_code,title,category,subcategory,port,problem,possible_cause,resolution,suggested_action,keywords,
 requires_port_verification,human_review_required,ai_reply_allowed,active,created_by,updated_by)
 values(p_article->>'knowledge_code',p_article->>'title',p_article->>'category',p_article->>'subcategory',p_article->>'port',p_article->>'problem',p_article->>'possible_cause',p_article->>'resolution',p_article->>'suggested_action',array(select jsonb_array_elements_text(p_article->'keywords')),
 (p_article->>'requires_port_verification')::boolean,(p_article->>'human_review_required')::boolean,(p_article->>'ai_reply_allowed')::boolean,(p_article->>'active')::boolean,p_admin,p_admin) returning * into saved;
 else
 update public.support_knowledge set knowledge_code=p_article->>'knowledge_code',title=p_article->>'title',category=p_article->>'category',subcategory=p_article->>'subcategory',port=p_article->>'port',problem=p_article->>'problem',possible_cause=p_article->>'possible_cause',resolution=p_article->>'resolution',suggested_action=p_article->>'suggested_action',keywords=array(select jsonb_array_elements_text(p_article->'keywords')),
 requires_port_verification=(p_article->>'requires_port_verification')::boolean,human_review_required=(p_article->>'human_review_required')::boolean,ai_reply_allowed=(p_article->>'ai_reply_allowed')::boolean,active=(p_article->>'active')::boolean,updated_by=p_admin where id=p_id returning * into saved;
 end if;
 return to_jsonb(saved);
exception when unique_violation then return jsonb_build_object('error','DUPLICATE_CODE');
end;$$;
create function public.match_support_knowledge(p_id uuid) returns jsonb
language sql stable set search_path=pg_catalog,public as $$
 with analysis as (select public.get_support_analysis(c.id) as data,public.support_analysis_snapshot(c.id) as snapshot from public.support_cases c where c.id=p_id),
 source as (select data->'interaction' as a,(data->>'stale')::boolean as stale,
 lower((snapshot->>'subject')||' '||coalesce((select string_agg(left(m->>'body_text',3000),' ') from jsonb_array_elements(snapshot->'messages')m where m->>'direction'='INBOUND'),'')) as evidence from analysis),
 ranked as (
 select k.*,((case when k.subcategory=s.a->>'subcategory' then 30 else 0 end)+(case when k.port=s.a->>'port' then 20 else 0 end)+
 least(10,(select count(*)::int from unnest(k.keywords)kw where length(btrim(kw))>0 and strpos(s.evidence,lower(kw))>0))) as match_score
 from public.support_knowledge k cross join source s
 where not s.stale and s.a is not null and k.active and k.category=s.a->>'category'
 and (k.subcategory is null or k.subcategory=s.a->>'subcategory') and (k.port='ALL' or k.port=s.a->>'port')
 ), top_matches as (select * from ranked order by match_score desc,knowledge_code,id limit 5)
 select jsonb_build_object('interaction_id',s.a->>'id','stale',s.stale,'articles',coalesce((select jsonb_agg(to_jsonb(t) order by match_score desc,knowledge_code,id) from top_matches t),'[]'::jsonb)) from source s;
$$;
revoke all on function public.list_support_knowledge(jsonb),public.save_support_knowledge(uuid,timestamptz,jsonb,uuid),public.match_support_knowledge(uuid) from public,anon,authenticated;
grant execute on function public.list_support_knowledge(jsonb),public.save_support_knowledge(uuid,timestamptz,jsonb,uuid),public.match_support_knowledge(uuid) to service_role;
commit;
