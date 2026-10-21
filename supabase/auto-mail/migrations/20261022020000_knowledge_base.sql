-- Apply to the separate Auto Mail project only, after Milestones 1 and 2.
begin;
alter table auto_mail.settings drop constraint settings_schema_version_check;
alter table auto_mail.settings add constraint settings_schema_version_check check (schema_version in (1, 2, 3));

alter table auto_mail.knowledge_articles
  add column summary text not null default '',
  add column category text not null default 'General',
  add column port text not null default 'ALL',
  add column keywords text[] not null default '{}',
  add column updated_by uuid,
  add column updated_at timestamptz not null default now();
update auto_mail.knowledge_articles set updated_by = created_by;
alter table auto_mail.knowledge_articles alter column updated_by set not null;
alter table auto_mail.knowledge_articles add column search_document tsvector generated always as (
  setweight(to_tsvector('simple', title), 'A') ||
  setweight(to_tsvector('simple', summary), 'B') ||
  setweight(to_tsvector('simple', content), 'C')
) stored;
create index knowledge_articles_search on auto_mail.knowledge_articles using gin(search_document);
create index knowledge_articles_status on auto_mail.knowledge_articles(status, updated_at desc);

create table auto_mail.knowledge_revisions (
  id uuid primary key default gen_random_uuid(),
  article_id uuid not null references auto_mail.knowledge_articles(id),
  version integer not null,
  action text not null check (action in ('CREATED', 'EDITED', 'APPROVED', 'ARCHIVED', 'RETURNED_TO_DRAFT', 'IMPORTED')),
  actor_id uuid not null,
  snapshot jsonb not null,
  created_at timestamptz not null default now(),
  unique(article_id, version)
);
alter table auto_mail.knowledge_revisions enable row level security;
revoke all on auto_mail.knowledge_revisions from public, anon, authenticated, service_role;
grant select on auto_mail.knowledge_revisions to service_role;
-- Mutations go through the versioned RPCs; revision history is append-only.
revoke insert, update, delete on auto_mail.knowledge_articles from service_role;

insert into auto_mail.knowledge_revisions(article_id, version, action, actor_id, snapshot)
select id, version, 'IMPORTED', updated_by, to_jsonb(k) - 'search_document'
from auto_mail.knowledge_articles k;

create function auto_mail.save_knowledge_article(p_id uuid, p_expected_version integer, p_article jsonb, p_actor uuid)
returns jsonb language plpgsql security definer set search_path = pg_catalog, auto_mail as $$
declare current_article auto_mail.knowledge_articles; saved auto_mail.knowledge_articles; tags text[];
begin
  if p_actor is null then raise exception 'KB_INVALID_ACTOR'; end if;
  if jsonb_typeof(p_article->'keywords') is distinct from 'array' then raise exception 'KB_INVALID_ARTICLE'; end if;
  tags := array(select distinct btrim(value) from jsonb_array_elements_text(p_article->'keywords') where btrim(value) <> '');
  if coalesce(length(btrim(p_article->>'title')), 0) not between 1 and 160
    or coalesce(length(btrim(p_article->>'content')), 0) not between 1 and 30000
    or coalesce(length(p_article->>'summary'), 0) > 400
    or coalesce(length(btrim(p_article->>'category')), 0) not between 1 and 80
    or coalesce(length(btrim(p_article->>'port')), 0) not between 1 and 80
    or cardinality(tags) > 20 or exists(select 1 from unnest(tags) tag where length(tag) > 60)
  then raise exception 'KB_INVALID_ARTICLE'; end if;

  if p_id is null then
    insert into auto_mail.knowledge_articles(title, content, summary, category, port, keywords, created_by, updated_by)
    values(btrim(p_article->>'title'), btrim(p_article->>'content'), coalesce(p_article->>'summary', ''),
      btrim(p_article->>'category'), upper(btrim(p_article->>'port')), tags, p_actor, p_actor) returning * into saved;
  else
    select * into current_article from auto_mail.knowledge_articles where id = p_id for update;
    if not found then raise exception 'KB_NOT_FOUND'; end if;
    if current_article.version is distinct from p_expected_version then raise exception 'KB_CONFLICT'; end if;
    -- Changing even an approved article creates a draft that needs approval again.
    update auto_mail.knowledge_articles set title = btrim(p_article->>'title'), content = btrim(p_article->>'content'),
      summary = coalesce(p_article->>'summary', ''), category = btrim(p_article->>'category'), port = upper(btrim(p_article->>'port')),
      keywords = tags, status = 'DRAFT', approved_by = null, approved_at = null,
      version = version + 1, updated_by = p_actor, updated_at = clock_timestamp()
    where id = p_id returning * into saved;
  end if;
  insert into auto_mail.knowledge_revisions(article_id, version, action, actor_id, snapshot)
  values(saved.id, saved.version, case when p_id is null then 'CREATED' else 'EDITED' end, p_actor, to_jsonb(saved) - 'search_document');
  return to_jsonb(saved) - 'search_document';
end; $$;

create function auto_mail.review_knowledge_article(p_id uuid, p_expected_version integer, p_action text, p_actor uuid)
returns jsonb language plpgsql security definer set search_path = pg_catalog, auto_mail as $$
declare current_article auto_mail.knowledge_articles; saved auto_mail.knowledge_articles; target_status text;
begin
  if p_actor is null then raise exception 'KB_INVALID_ACTOR'; end if;
  target_status := case p_action when 'APPROVE' then 'APPROVED' when 'ARCHIVE' then 'ARCHIVED' when 'DRAFT' then 'DRAFT' end;
  if target_status is null then raise exception 'KB_INVALID_ACTION'; end if;
  select * into current_article from auto_mail.knowledge_articles where id = p_id for update;
  if not found then raise exception 'KB_NOT_FOUND'; end if;
  if current_article.version is distinct from p_expected_version then raise exception 'KB_CONFLICT'; end if;
  if current_article.status = target_status or (p_action = 'APPROVE' and current_article.status <> 'DRAFT') then raise exception 'KB_INVALID_TRANSITION'; end if;
  update auto_mail.knowledge_articles set status = target_status, version = version + 1, updated_by = p_actor,
    updated_at = clock_timestamp(), approved_by = case when target_status = 'APPROVED' then p_actor end,
    approved_at = case when target_status = 'APPROVED' then clock_timestamp() end
  where id = p_id returning * into saved;
  insert into auto_mail.knowledge_revisions(article_id, version, action, actor_id, snapshot)
  values(saved.id, saved.version, case p_action when 'APPROVE' then 'APPROVED' when 'ARCHIVE' then 'ARCHIVED' else 'RETURNED_TO_DRAFT' end,
    p_actor, to_jsonb(saved) - 'search_document');
  return to_jsonb(saved) - 'search_document';
end; $$;

create function auto_mail.list_knowledge_articles(p_query text default '', p_status text default '', p_offset integer default 0)
returns jsonb language sql stable security definer set search_path = pg_catalog, auto_mail as $$
  with filtered as (
    select * from auto_mail.knowledge_articles k
    where (coalesce(p_status, '') = '' or k.status = p_status)
    and (coalesce(btrim(p_query), '') = '' or strpos(lower(k.title || ' ' || k.summary || ' ' || k.content || ' ' || k.category || ' ' || k.port || ' ' || array_to_string(k.keywords, ' ')), lower(btrim(p_query))) > 0)
  ), page as (
    select * from filtered order by updated_at desc, id limit 25 offset greatest(0, least(100000, coalesce(p_offset, 0)))
  )
  select jsonb_build_object('articles', coalesce((select jsonb_agg(to_jsonb(p) - 'search_document' - 'content' order by updated_at desc, id) from page p), '[]'::jsonb), 'total', (select count(*) from filtered));
$$;

create function auto_mail.match_knowledge_articles(p_query text)
returns jsonb language sql stable security definer set search_path = pg_catalog, auto_mail as $$
  -- Lexical retrieval only. These ranks are search scores, not AI confidence.
  with words as (
    select word from unnest(tsvector_to_array(to_tsvector('simple', left(coalesce(p_query, ''), 4000)))) word
    where length(word) > 2 and word <> all(array['the','and','for','that','this','with','from','your','you','are','was','have','has','can','please','help','thanks','thank','regards','hello','dear','would','could','will','about','email','com','gmail','yang','dan','untuk','dengan','saya','kami','boleh','tolong','terima','kasih'])
    order by word limit 40
  ), query as (
    select to_tsquery('simple', string_agg(quote_literal(word), ' | ')) as q from words
  ), ranked as (
    select k.*, coalesce(ts_rank_cd(k.search_document, q.q), 0) +
      (select count(*)::real / 10 from unnest(k.keywords) tag where strpos(lower(left(p_query, 4000)), lower(tag)) > 0) as score
    from auto_mail.knowledge_articles k cross join query q
    where k.status = 'APPROVED' and (k.search_document @@ q.q or exists(select 1 from unnest(k.keywords) tag where length(tag) > 2 and strpos(lower(left(p_query, 4000)), lower(tag)) > 0))
    order by score desc, k.id limit 5
  ) select coalesce(jsonb_agg(jsonb_build_object('id', id, 'title', title, 'summary', summary, 'content', content,
    'category', category, 'port', port, 'version', version, 'keywords', keywords) order by score desc, id), '[]'::jsonb) from ranked;
$$;

revoke all on function auto_mail.save_knowledge_article(uuid, integer, jsonb, uuid), auto_mail.review_knowledge_article(uuid, integer, text, uuid),
  auto_mail.list_knowledge_articles(text, text, integer), auto_mail.match_knowledge_articles(text) from public, anon, authenticated;
grant execute on function auto_mail.save_knowledge_article(uuid, integer, jsonb, uuid), auto_mail.review_knowledge_article(uuid, integer, text, uuid),
  auto_mail.list_knowledge_articles(text, text, integer), auto_mail.match_knowledge_articles(text) to service_role;
update auto_mail.settings set schema_version = 3 where id = 'system';
notify pgrst, 'reload schema';
commit;
