-- Milestone 3: read-only, admin API queries. No browser grants or AI calls.
begin;

-- Definer reads the private Auth ID mapping for staff labels. Execute is
-- explicitly restricted to service_role; never grant it to browser roles.
create function public.list_support_cases(p_filters jsonb default '{}')
returns jsonb language sql stable security definer set search_path = pg_catalog, public as $$
  with filtered as (
    select c.* from public.support_cases c
    where (nullif(p_filters->>'status','') is null or c.status = p_filters->>'status')
      and (nullif(p_filters->>'category','') is null or c.category = p_filters->>'category')
      and (nullif(p_filters->>'port','') is null or c.port = p_filters->>'port')
      and (nullif(p_filters->>'assigned_to','') is null
        or (p_filters->>'assigned_to' = 'UNASSIGNED' and c.assigned_to is null)
        or c.assigned_to::text = p_filters->>'assigned_to')
      and (nullif(p_filters->>'confidence','') is null
        or (p_filters->>'confidence' = 'HIGH' and c.ai_confidence >= 0.9)
        or (p_filters->>'confidence' = 'MEDIUM' and c.ai_confidence >= 0.7 and c.ai_confidence < 0.9)
        or (p_filters->>'confidence' = 'LOW' and c.ai_confidence < 0.7)
        or (p_filters->>'confidence' = 'NONE' and c.ai_confidence is null))
      and (nullif(p_filters->>'from','') is null or c.created_at >= (p_filters->>'from')::timestamptz)
      and (nullif(p_filters->>'to','') is null or c.created_at < (p_filters->>'to')::timestamptz)
      and (nullif(btrim(p_filters->>'q'),'') is null
        or strpos(lower(coalesce(c.customer_name,'') || ' ' || c.customer_email || ' ' || c.subject),lower(p_filters->>'q')) > 0
        or exists(select 1 from public.support_messages m where m.case_id = c.id
          and strpos(lower(coalesce(m.sender_name,'') || ' ' || m.sender_email || ' ' || m.subject || ' ' || m.body_text),lower(p_filters->>'q')) > 0))
  ), page as (
    select f.*, latest.body_text as preview, latest.sent_at as last_message_at
    from filtered f left join lateral (
      select left(m.body_text,180) as body_text, m.sent_at from public.support_messages m
      where m.case_id=f.id order by m.sent_at desc,m.id desc limit 1
    ) latest on true
    order by f.updated_at desc,f.id desc
    limit 20 offset greatest(0,least(100000,coalesce((p_filters->>'offset')::integer,0)))
  ) select jsonb_build_object('cases',coalesce((select jsonb_agg(to_jsonb(page) order by updated_at desc,id desc) from page),'[]'::jsonb),
    'total',(select count(*) from filtered),
    'assignees',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'name',u.full_name,'email',u.email))
      from auth.users a join public.user_registrations u on lower(u.email)=lower(a.email) where u.type='ADMIN'),'[]'::jsonb));
$$;

create function public.get_support_case(p_id uuid,p_offset integer default 0)
returns jsonb language sql stable security definer set search_path = pg_catalog, public as $$
  select jsonb_build_object('supportCase',to_jsonb(c) || jsonb_build_object('assigned_name',
    (select u.full_name from auth.users a join public.user_registrations u on lower(u.email)=lower(a.email)
      where a.id=c.assigned_to and u.type='ADMIN' limit 1)),
    'messages',coalesce((select jsonb_agg(to_jsonb(m) order by sent_at,id) from (
      select * from public.support_messages where case_id=c.id order by sent_at desc,id desc
      limit 50 offset greatest(0,least(100000,p_offset))
    ) m),'[]'::jsonb),
    'message_total',(select count(*) from public.support_messages where case_id=c.id),
    'interactions','[]'::jsonb)
  from public.support_cases c where c.id=p_id;
$$;

create function public.support_inbox_stats()
returns jsonb language sql stable set search_path = public as $$
  select jsonb_build_object(
    'new_cases',count(*) filter(where status='NEW'),
    'open_cases',count(*) filter(where status <> 'RESOLVED'),
    'need_review',count(*) filter(where status='NEEDS_REVIEW'),
    'ai_drafts',count(*) filter(where status='DRAFTED'),
    'resolved_today',count(*) filter(where resolved_at >= date_trunc('day',now() at time zone 'UTC') at time zone 'UTC'),
    'total_cases',count(*),
    'categories',coalesce((select jsonb_agg(to_jsonb(t)) from (
      select category as name,count(*) as count from public.support_cases group by category order by count(*) desc,category
    ) t),'[]'::jsonb),
    'ports',coalesce((select jsonb_agg(to_jsonb(t)) from (
      select port as name,count(*) as count from public.support_cases group by port order by count(*) desc,port
    ) t),'[]'::jsonb)) from public.support_cases;
$$;

revoke all on function public.list_support_cases(jsonb) from public,anon,authenticated;
revoke all on function public.get_support_case(uuid,integer) from public,anon,authenticated;
revoke all on function public.support_inbox_stats() from public,anon,authenticated;
grant execute on function public.list_support_cases(jsonb) to service_role;
grant execute on function public.get_support_case(uuid,integer) to service_role;
grant execute on function public.support_inbox_stats() to service_role;
commit;
