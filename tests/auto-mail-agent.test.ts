import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import agentSettings from '../server-handlers/auto-mail/agent-settings.js';
import { effectiveAiConfiguration, readAgentSettings } from '../server-handlers/auto-mail/agent-config.js';
import { signSession } from '../api/_runtime.js';

const actor = '10000000-0000-4000-8000-000000000001';
test('agent settings use new tables, serialize versioned changes, audit saves and block direct writes', async () => {
  const db = new PGlite();
  try {
    await db.exec("create role anon;create role authenticated;create role service_role bypassrls;create schema auto_mail;grant usage on schema auto_mail to service_role;create table auto_mail.settings(reply_mode text);insert into auto_mail.settings values('DRAFT_ONLY');create table public.untouched(value text);insert into public.untouched values('original');");
    await db.exec(readFileSync(new URL('../supabase/auto-mail/migrations/20261022050000_agent_settings.sql', import.meta.url), 'utf8'));
    const scalar = async (sql: string, params: unknown[] = []) => Object.values((await db.query<any>(sql, params)).rows[0])[0] as any;
    const save = (enabled: boolean, model: string, models: string[], version: number) => scalar('select auto_mail.save_agent_settings($1,$2,$3,$4,$5)', [enabled, model, models, version, actor]);
    await db.exec('set role service_role');
    const first = await save(true, 'gpt-5.4-mini', ['gpt-5.4-mini'], 0);
    assert.equal(first.version, 1); assert.equal(first.updated_by, actor);
    await assert.rejects(() => save(true, 'gpt-5.4-mini', [], 1), /AGENT_INVALID/);
    await assert.rejects(() => save(true, 'gpt-5.4-mini', ['gpt-5.4-mini'], 0), /AGENT_CONFLICT/);
    await assert.rejects(() => save(false, 'invalid model!', [], 1), /AGENT_INVALID/);
    const disabled = await save(false, 'gpt-5.4-mini', [], 1);
    assert.equal(disabled.enabled, false); assert.equal(disabled.version, 2);
    const changed = await save(true, 'gpt-4.1-mini', ['gpt-4.1-mini'], 2);
    assert.equal(changed.model, 'gpt-4.1-mini');
    assert.equal(await scalar('select count(*)::int from auto_mail.agent_setting_events'), 3);
    await assert.rejects(() => db.exec('delete from auto_mail.agent_settings'), /permission denied/);
    await db.exec('reset role');
    assert.equal(await scalar("select has_function_privilege('authenticated','auto_mail.save_agent_settings(boolean,text,text[],integer,uuid)','EXECUTE')"), false);
    assert.equal(await scalar('select reply_mode from auto_mail.settings'), 'DRAFT_ONLY');
    assert.equal(await scalar('select value from public.untouched'), 'original');
  } finally { await db.close(); }
});

test('effective model honors the administrator setting, server disable and fail-closed storage errors', async () => {
  let record: any = { enabled: true, model: 'gpt-5.4-mini', enabled_models: ['gpt-5.4-mini'], version: 1 };
  let error: any = null;
  const client = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: record, error }) }) }) }) } as any;
  const env = { AUTO_MAIL_AI_ENABLED: 'true', OPENAI_API_KEY: 'private-test-key', AUTO_MAIL_AI_MODEL: 'server-default' };
  assert.equal((await effectiveAiConfiguration(client, env)).model, 'gpt-5.4-mini');
  record.enabled = false; assert.equal((await effectiveAiConfiguration(client, env)).ready, false);
  record.enabled = true; assert.equal((await effectiveAiConfiguration(client, { ...env, AUTO_MAIL_AI_ENABLED: 'false' })).ready, false);
  record.enabled_models = []; assert.equal((await effectiveAiConfiguration(client, env)).ready, false);
  record = null; error = { code: 'PGRST205' };
  assert.equal((await readAgentSettings(client, env)).storageReady, false);
  assert.equal((await effectiveAiConfiguration(client, env)).model, 'server-default');
  error = { code: 'XX000' }; await assert.rejects(() => effectiveAiConfiguration(client, env), /unavailable/);
});

test('agent routes require admin and same origin, ignore client actor, keep keys private and return conflicts', async () => {
  const overrides = { AUTO_MAIL_ENABLED: 'true', AUTO_MAIL_SUPABASE_URL: 'https://agent-dev.supabase.co', AUTO_MAIL_SUPABASE_SERVICE_ROLE_KEY: 'test-db-key', SUPABASE_URL: 'https://main.supabase.co', VITE_SUPABASE_URL: 'https://main.supabase.co', AUTO_MAIL_APP_URL: 'http://localhost:3000', SESSION_SECRET: 'agent-test', OPENAI_API_KEY: 'private-test-key', AUTO_MAIL_AI_ENABLED: 'true', AUTO_MAIL_AI_MODEL: 'env-model' };
  const before = Object.fromEntries(Object.keys(overrides).map(key => [key, process.env[key]])); Object.assign(process.env, overrides);
  const original = globalThis.fetch; let calls = 0; let conflict = false;
  globalThis.fetch = (async (input: any, init: any = {}) => {
    calls++; const url = new URL(String(input)); assert.equal(url.hostname, 'agent-dev.supabase.co');
    if (url.pathname.endsWith('/agent_settings')) return new Response('null', { status: 200 });
    assert.ok(url.pathname.endsWith('/save_agent_settings'));
    assert.equal(JSON.parse(init.body).p_actor, actor);
    return new Response(JSON.stringify(conflict ? { message: 'AGENT_CONFLICT' } : { enabled: true, model: 'gpt-5.4-mini', enabled_models: ['gpt-5.4-mini'], version: 1 }), { status: conflict ? 400 : 200 });
  }) as typeof fetch;
  const cookie = 'cargomove_session=' + signSession({ id: actor, email: 'admin@example.com', type: 'ADMIN', exp: Date.now() + 60000 });
  const invoke = async (method = 'GET', body: any = {}, headers: any = { cookie, origin: 'http://localhost:3000' }) => {
    const res = { code: 200, value: null as any, setHeader() {}, status(code: number) { this.code = code; return this; }, json(value: any) { this.value = value; } };
    await agentSettings({ method, body, headers }, res); return res;
  };
  try {
    assert.equal((await invoke('GET', {}, {})).code, 401);
    assert.equal((await invoke('POST', {}, { cookie, origin: 'https://evil.test' })).code, 403); assert.equal(calls, 0);
    const loaded = await invoke(); assert.equal(loaded.value.settings.version, 0); assert.ok(!JSON.stringify(loaded.value).includes('private-test-key'));
    const body = { enabled: true, model: 'gpt-5.4-mini', enabledModels: ['gpt-5.4-mini'], version: 0, actor: 'attacker' };
    assert.equal((await invoke('POST', body)).code, 200);
    assert.equal((await invoke('POST', { ...body, enabledModels: [] })).code, 400);
    conflict = true; assert.equal((await invoke('POST', body)).code, 409);
  } finally { globalThis.fetch = original; for (const key of Object.keys(overrides)) { if (before[key] === undefined) delete process.env[key]; else process.env[key] = before[key]; } }
});
