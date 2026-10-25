import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

test('Auto Register in CM persists configuration, skips while off, serializes runs and deduplicates schedule retries', async () => {
  const db = new PGlite();
  const actor = '10000000-0000-4000-8000-000000000001';
  const revoked = '10000000-0000-4000-8000-000000000002';
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth;
      create table auth.users(id uuid primary key,email text,created_at timestamptz default now());
      create table public.user_registrations(email text,type text);
      insert into auth.users(id,email) values('${actor}','admin@example.test'),('${revoked}','revoked@example.test');
      insert into public.user_registrations values('ADMIN@EXAMPLE.TEST','ADMIN'),('revoked@example.test','COMPANY_ADMIN');`);
    await db.exec(readFileSync(new URL('../supabase/migrations/20261025030000_auto_register_cm_scheduler.sql', import.meta.url), 'utf8'));
    const scalar = async (sql: string, params: unknown[] = []) => Object.values((await db.query<any>(sql, params)).rows[0])[0] as any;
    const acquire = (type: 'AUTOMATIC' | 'MANUAL', key: string | null, who = actor) => scalar(
      'select acquire_automation_scheduler($1,$2,$3,$4)', ['auto_register_cm', type, who, key]);

    assert.equal(await scalar("select is_enabled from automation_schedulers where scheduler_key='auto_register_cm'"), false);
    assert.deepEqual(await scalar('select auto_register_cm_actor()'), { id: actor, email: 'admin@example.test' });
    const disabled = await acquire('AUTOMATIC', 'window-1');
    assert.equal(disabled.reason, 'disabled');
    assert.equal(await scalar('select status from automation_scheduler_runs where id=$1', [disabled.id]), 'SKIPPED');

    await db.exec("update automation_schedulers set is_enabled=true where scheduler_key='auto_register_cm'");
    const first = await acquire('AUTOMATIC', 'window-2');
    assert.ok(first.id);
    assert.equal((await acquire('MANUAL', null)).reason, 'running');
    assert.equal(await scalar("select finish_automation_scheduler($1,'SUCCESS',3,2,1,'Completed',null)", [first.id]), true);
    assert.deepEqual(await acquire('AUTOMATIC', 'window-2'), { reason: 'duplicate', id: first.id, status: 'SUCCESS' });
    assert.equal(await scalar("select last_status from automation_schedulers where scheduler_key='auto_register_cm'"), 'SUCCESS');
    assert.equal(await scalar('select processed_count from automation_scheduler_runs where id=$1', [first.id]), 3);

    await db.exec("update automation_schedulers set is_enabled=false where scheduler_key='auto_register_cm'");
    const manual = await acquire('MANUAL', null);
    assert.ok(manual.id, 'Manual execution remains available while automatic scheduling is off');
    assert.equal(await scalar("select finish_automation_scheduler($1,'SKIPPED',0,0,0,'Nothing pending',null)", [manual.id]), true);
    await assert.rejects(() => acquire('MANUAL', null, revoked), /Administrator required/);
    assert.equal(await scalar("select has_function_privilege('authenticated','public.acquire_automation_scheduler(text,text,uuid,text)','EXECUTE')"), false);
    assert.equal(await scalar("select has_function_privilege('service_role','public.acquire_automation_scheduler(text,text,uuid,text)','EXECUTE')"), true);
  } finally { await db.close(); }
});
