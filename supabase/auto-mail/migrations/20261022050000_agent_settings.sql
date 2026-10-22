-- Separate Auto Mail project ONLY. Adds new tables; existing tables are unchanged.
begin;
create table auto_mail.agent_settings (
  id text primary key check(id='system'),
  enabled boolean not null,
  model text not null check(model ~ '^[a-zA-Z0-9._:-]{1,100}$'),
  enabled_models text[] not null,
  version integer not null default 1 check(version>0),
  updated_by uuid not null,
  updated_at timestamptz not null default now(),
  check(not enabled or model=any(enabled_models))
);
create table auto_mail.agent_setting_events (
  id uuid primary key default gen_random_uuid(),
  version integer not null unique,
  actor_id uuid not null,
  settings jsonb not null,
  created_at timestamptz not null default now()
);
alter table auto_mail.agent_settings enable row level security;
alter table auto_mail.agent_setting_events enable row level security;
revoke all on auto_mail.agent_settings,auto_mail.agent_setting_events from public,anon,authenticated,service_role;
grant select on auto_mail.agent_settings,auto_mail.agent_setting_events to service_role;

create function auto_mail.save_agent_settings(p_enabled boolean,p_model text,p_models text[],p_version integer,p_actor uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog,auto_mail as $$
declare saved auto_mail.agent_settings;
begin
  if p_actor is null or p_enabled is null or p_model is null or p_model !~ '^[a-zA-Z0-9._:-]{1,100}$'
    or p_models is null or cardinality(p_models)>30 or p_version is null or p_version<0
    or exists(select 1 from unnest(p_models) m where m is null or m !~ '^[a-zA-Z0-9._:-]{1,100}$')
    or cardinality(p_models)<>(select count(distinct m) from unnest(p_models) m)
    or (p_enabled and not p_model=any(p_models)) then raise exception 'AGENT_INVALID'; end if;
  -- Serialize the singleton's first save as well as updates without locking old tables.
  perform pg_advisory_xact_lock(781940225);
  select * into saved from auto_mail.agent_settings where id='system' for update;
  if (found and saved.version<>p_version) or (not found and p_version<>0) then raise exception 'AGENT_CONFLICT'; end if;
  insert into auto_mail.agent_settings(id,enabled,model,enabled_models,version,updated_by)
  values('system',p_enabled,p_model,p_models,p_version+1,p_actor)
  on conflict(id) do update set enabled=excluded.enabled,model=excluded.model,enabled_models=excluded.enabled_models,
    version=excluded.version,updated_by=excluded.updated_by,updated_at=clock_timestamp()
  returning * into saved;
  insert into auto_mail.agent_setting_events(version,actor_id,settings) values(saved.version,p_actor,to_jsonb(saved));
  return to_jsonb(saved);
end; $$;
revoke all on function auto_mail.save_agent_settings(boolean,text,text[],integer,uuid) from public,anon,authenticated;
grant execute on function auto_mail.save_agent_settings(boolean,text,text[],integer,uuid) to service_role;
notify pgrst,'reload schema';
commit;
