-- Milestone 2: private, resumable single-mailbox sync. No AI or email sends.
begin;

create table public.gmail_sync_state (
  id text primary key references public.gmail_connections(id) on delete restrict,
  google_subject text not null,
  mode text not null default 'BOOTSTRAP' check (mode in ('BOOTSTRAP', 'HISTORY')),
  history_id text,
  bootstrap_history_id text,
  bootstrap_after bigint not null default extract(epoch from (now() - interval '30 days'))::bigint,
  recovery_pending boolean not null default false,
  recovery_cursor uuid,
  pending_recovery_cursor uuid,
  page_token text,
  page_staged boolean not null default false,
  pending_threads text[] not null default '{}',
  pending_page_token text,
  pending_history_id text,
  lease_token uuid,
  lease_expires_at timestamptz,
  connection_version timestamptz,
  last_synced_at timestamptz,
  updated_at timestamptz not null default now(),
  check (history_id is null or history_id ~ '^[0-9]+$'),
  check (bootstrap_history_id is null or bootstrap_history_id ~ '^[0-9]+$'),
  check (pending_history_id is null or pending_history_id ~ '^[0-9]+$')
);
alter table public.gmail_sync_state enable row level security;
revoke all on public.gmail_sync_state from public, anon, authenticated;
grant select, insert, update, delete on public.gmail_sync_state to service_role;
create trigger gmail_sync_state_touch_updated_at before update on public.gmail_sync_state
for each row execute function public.touch_updated_at();

-- Row locks serialize workers; a short lease fences a crashed/stale worker.
create function public.acquire_gmail_sync(p_subject text, p_version timestamptz, p_token uuid)
returns jsonb language plpgsql set search_path = public as $$
declare s public.gmail_sync_state; c public.gmail_connections;
begin
  select * into c from public.gmail_connections where id = 'system' for share;
  if c.status <> 'ACTIVE' or c.google_subject is distinct from p_subject or c.connected_at is distinct from p_version then
    raise exception 'GMAIL_CONNECTION_CHANGED';
  end if;
  insert into public.gmail_sync_state(id, google_subject) values ('system', p_subject) on conflict (id) do nothing;
  select * into s from public.gmail_sync_state where id = 'system' for update;
  if s.google_subject <> p_subject then raise exception 'GMAIL_MAILBOX_CHANGED'; end if;
  if s.lease_expires_at > now() then raise exception 'GMAIL_SYNC_BUSY'; end if;
  update public.gmail_sync_state set lease_token = p_token, lease_expires_at = now() + interval '90 seconds',
    connection_version = p_version where id = 'system' returning * into s;
  return to_jsonb(s);
end;
$$;

create function public.checkpoint_gmail_sync(p_token uuid, p_state jsonb, p_release boolean default false)
returns void language plpgsql set search_path = public as $$
declare s public.gmail_sync_state; c public.gmail_connections;
begin
  select * into c from public.gmail_connections where id = 'system' for share;
  select * into s from public.gmail_sync_state where id = 'system' for update;
  if s.lease_token is distinct from p_token or s.lease_expires_at <= now()
    or c.google_subject is distinct from s.google_subject or c.connected_at is distinct from s.connection_version
    or c.status <> 'ACTIVE' then raise exception 'GMAIL_SYNC_LEASE_LOST'; end if;
  update public.gmail_sync_state set
    recovery_pending = (p_state->>'recovery_pending')::boolean,
    recovery_cursor = (p_state->>'recovery_cursor')::uuid,
    pending_recovery_cursor = (p_state->>'pending_recovery_cursor')::uuid,
    mode = p_state->>'mode', history_id = p_state->>'history_id',
    bootstrap_history_id = p_state->>'bootstrap_history_id',
    bootstrap_after = (p_state->>'bootstrap_after')::bigint,
    page_token = p_state->>'page_token', page_staged = (p_state->>'page_staged')::boolean,
    pending_threads = array(select jsonb_array_elements_text(p_state->'pending_threads')),
    pending_page_token = p_state->>'pending_page_token', pending_history_id = p_state->>'pending_history_id',
    last_synced_at = (p_state->>'last_synced_at')::timestamptz,
    lease_token = case when p_release then null else p_token end,
    lease_expires_at = case when p_release then null else now() + interval '90 seconds' end
  where id = 'system';
end;
$$;

-- Case creation and every message in a thread commit together. On retry,
-- conflict-do-nothing preserves existing records and human case changes.
create function public.persist_gmail_thread(p_token uuid, p_thread_id text, p_messages jsonb)
returns integer language plpgsql set search_path = public as $$
declare s public.gmail_sync_state; c public.gmail_connections; case_row public.support_cases;
  first_inbound jsonb; m jsonb; inserted integer := 0; count_row integer;
  previous_latest timestamptz; newest_new_inbound timestamptz;
begin
  select * into c from public.gmail_connections where id = 'system' for share;
  select * into s from public.gmail_sync_state where id = 'system' for update;
  if s.lease_token is distinct from p_token or s.lease_expires_at <= now()
    or c.google_subject is distinct from s.google_subject or c.connected_at is distinct from s.connection_version
    or c.status <> 'ACTIVE' then raise exception 'GMAIL_SYNC_LEASE_LOST'; end if;
  if p_thread_id is distinct from s.pending_threads[1] then raise exception 'INVALID_PENDING_THREAD'; end if;
  if jsonb_typeof(p_messages) is distinct from 'array' then raise exception 'INVALID_MESSAGES'; end if;
  select * into case_row from public.support_cases where gmail_thread_id = p_thread_id for update;
  if case_row.id is null then
    select value into first_inbound from jsonb_array_elements(p_messages)
      where value->>'direction' = 'INBOUND' and (value->>'in_inbox')::boolean
      order by value->>'sent_at' limit 1;
    -- Outbound-only/unrelated archived threads do not create support cases.
    if first_inbound is null then return 0; end if;
    insert into public.support_cases(gmail_thread_id, customer_name, customer_email, subject)
      values(p_thread_id, first_inbound->>'sender_name', first_inbound->>'sender_email', first_inbound->>'subject')
      returning * into case_row;
  end if;
  select max(sent_at) into previous_latest from public.support_messages where case_id = case_row.id;
  for m in select value from jsonb_array_elements(p_messages) loop
    if m->>'gmail_thread_id' is distinct from p_thread_id then raise exception 'INVALID_MESSAGE_THREAD'; end if;
    if exists(select 1 from public.support_messages where gmail_message_id = m->>'gmail_message_id'
      and gmail_thread_id is distinct from p_thread_id) then raise exception 'MESSAGE_THREAD_CONFLICT'; end if;
    insert into public.support_messages(case_id, gmail_message_id, gmail_thread_id, direction,
      sender_name, sender_email, recipient_email, subject, body_text, body_html, sent_at)
    values(case_row.id, m->>'gmail_message_id', p_thread_id, m->>'direction', m->>'sender_name',
      m->>'sender_email', m->>'recipient_email', m->>'subject', m->>'body_text', m->>'body_html', (m->>'sent_at')::timestamptz)
    on conflict (gmail_message_id) do nothing;
    get diagnostics count_row = row_count;
    inserted := inserted + count_row;
    if count_row > 0 and m->>'direction' = 'INBOUND' then
      newest_new_inbound := greatest(newest_new_inbound, (m->>'sent_at')::timestamptz);
    end if;
  end loop;
  if inserted > 0 then
    -- New customer mail reopens a resolved/waiting conversation, but does not
    -- undo an escalation. Historical backfill cannot regress newer activity.
    update public.support_cases set
      status = case when newest_new_inbound is not null
        and (previous_latest is null or newest_new_inbound > previous_latest)
        and status <> 'ESCALATED' then 'NEW' else status end,
      resolved_at = case when newest_new_inbound is not null
        and (previous_latest is null or newest_new_inbound > previous_latest)
        and status <> 'ESCALATED' then null else resolved_at end,
      updated_at = now()
    where id = case_row.id;
  end if;
  return inserted;
end;
$$;

-- Expired-history recovery refreshes tracked conversations, including archived
-- ones, before rebaselining the recent inbox. Keyset paging stays bounded.
create function public.tracked_gmail_threads(p_after uuid default null)
returns jsonb language sql set search_path = public as $$
  select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from (
    select id, gmail_thread_id from public.support_cases
    where gmail_thread_id is not null and (p_after is null or id > p_after)
    order by id limit 10
  ) t;
$$;
revoke all on function public.tracked_gmail_threads(uuid) from public, anon, authenticated;
grant execute on function public.tracked_gmail_threads(uuid) to service_role;

create function public.release_gmail_sync(p_token uuid)
returns void language sql set search_path = public as $$
  update public.gmail_sync_state set lease_token = null, lease_expires_at = null
  where id = 'system' and lease_token = p_token;
$$;
revoke all on function public.release_gmail_sync(uuid) from public, anon, authenticated;
grant execute on function public.release_gmail_sync(uuid) to service_role;

revoke all on function public.acquire_gmail_sync(text,timestamptz,uuid) from public, anon, authenticated;
revoke all on function public.checkpoint_gmail_sync(uuid,jsonb,boolean) from public, anon, authenticated;
revoke all on function public.persist_gmail_thread(uuid,text,jsonb) from public, anon, authenticated;
grant execute on function public.acquire_gmail_sync(text,timestamptz,uuid) to service_role;
grant execute on function public.checkpoint_gmail_sync(uuid,jsonb,boolean) to service_role;
grant execute on function public.persist_gmail_thread(uuid,text,jsonb) to service_role;
commit;
