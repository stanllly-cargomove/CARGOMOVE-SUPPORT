import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

test('independent Cron driver starts planned windows, follows continuations and honors disabled/configuration guards without live HTTP', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema net; create schema vault; create schema extensions;
      create table test_clock(value timestamptz); insert into test_clock values('2026-10-26T12:06:00Z');
      create function test_now() returns timestamptz language sql as $$select value from test_clock$$;
      create table automation_schedulers(scheduler_key text primary key,is_enabled boolean);
      insert into automation_schedulers values('auto_register_cm',true);
      create table vault.decrypted_secrets(name text,decrypted_secret text);
      create table net.requests(id bigint generated always as identity,url text,body jsonb,headers jsonb,timeout_ms integer);
      create table net._http_response(id bigint,status_code integer,timed_out boolean,error_msg text,content text);
      create table hmac_calls(payload text,secret text,algorithm text);
      create function extensions.hmac(payload text,secret text,algorithm text) returns bytea language plpgsql as $$begin
        insert into public.hmac_calls values(payload,secret,algorithm); return decode(repeat('ab',32),'hex'); end$$;
      create function net.http_post(url text,body jsonb default '{}',params jsonb default '{}',headers jsonb default '{}',timeout_milliseconds integer default 1000)
      returns bigint language sql as $$insert into net.requests(url,body,headers,timeout_ms) values(url,body,headers,timeout_milliseconds) returning id$$;
    `);
    // Substitute only the clock; execute the actual migration and state machine.
    // net/Vault/crypto are local fixtures and never invoke a real provider.
    const migration = readFileSync(new URL('../supabase/migrations/20261026050000_auto_register_cm_cron_trigger.sql', import.meta.url), 'utf8');
    await db.exec(migration.replace(/\bnow\(\)/g, 'public.test_now()'));
    const scalar = async (sql: string, params: any[] = []) => Object.values((await db.query<any>(sql, params)).rows[0])[0] as any;
    const tick = () => scalar('select auto_register_cm_cron_tick()');
    const state = async () => (await db.query<any>('select * from auto_register_cm_cron_state')).rows[0];
    const requests = async () => (await db.query<any>('select * from net.requests order by id')).rows;
    const reply = async (status: number, body: any) => {
      const current = await state();
      await db.query('insert into net._http_response values($1,$2,false,null,$3)', [current.request_id,status,typeof body === 'string' ? body : JSON.stringify(body)]);
    };
    const clock = (time: string) => db.query('update test_clock set value=$1', [time]);
    const reset = async (time: string) => {
      await clock(time);
      await db.exec("update auto_register_cm_cron_state set delivery_window=null,request_id=null,request_body=null,chain_started_at=null,step_count=0,retry_count=0");
    };
    const token = '80000000-0000-4000-8000-000000000001';
    assert.equal(await tick(), 'DISABLED');
    await db.exec('update auto_register_cm_cron_state set is_enabled=true; update automation_schedulers set is_enabled=false');
    assert.equal(await tick(), 'APP_DISABLED');
    await db.exec('update automation_schedulers set is_enabled=true');
    assert.equal(await tick(), 'IDLE', 'No new window starts before minute 7');
    await clock('2026-10-26T12:07:00Z');
    assert.equal(await tick(), 'NOT_CONFIGURED');
    assert.equal((await requests()).length, 0);
    await db.exec("insert into vault.decrypted_secrets values('auto_register_cm_url','https://offline.example.test/api/scheduler/auto-register-cm'),('auto_register_cm_cron_secret','offline-secret')");
    assert.equal(await tick(), 'REQUESTED');
    const first = (await requests())[0];
    assert.deepEqual(first.body, { window: Math.floor(Date.parse('2026-10-26T12:07:00Z') / 1_200_000) });
    assert.equal(first.timeout_ms, 125000);
    assert.equal(first.headers.Authorization, undefined);
    assert.doesNotMatch(JSON.stringify(first.headers), /offline-secret/);
    const proof = (await db.query<any>('select * from hmac_calls')).rows[0];
    assert.equal(proof.payload, `auto-register-cm:v1\n${Date.parse('2026-10-26T12:07:00Z') / 1000}\nwindow:${first.body.window}`);
    assert.equal(proof.algorithm, 'sha256');
    assert.equal(await tick(), 'WAITING'); assert.equal((await requests()).length, 1);
    await reply(200, { status: 'success', continuationToken: token });
    assert.equal(await tick(), 'REQUESTED');
    assert.deepEqual((await requests())[1].body, { continuationToken: token });
    await db.exec('update automation_schedulers set is_enabled=false');
    assert.equal(await tick(), 'APP_DISABLED', 'Disabling the existing app toggle stops the next continuation');
    assert.equal((await requests()).length, 2);
    await db.exec('update automation_schedulers set is_enabled=true');
    await reply(200, { status: 'success', continuationToken: null });
    assert.equal(await tick(), 'COMPLETED');
    assert.equal(await tick(), 'IDLE', 'A completed delivery does not invoke empty work each minute');

    await clock('2026-10-26T12:27:00Z');
    assert.equal(await tick(), 'REQUESTED');
    await reply(401, { error: 'Unauthorized' });
    assert.equal(await tick(), 'FAILED'); assert.equal((await state()).last_error_code, 'HTTP_401');
    assert.equal(await tick(), 'IDLE', 'An authentication error is not retried indefinitely');

    await reset('2026-10-26T12:47:00Z');
    assert.equal(await tick(), 'REQUESTED');
    const pendingBody = (await state()).request_body;
    await reply(409, { message: 'Lease active' });
    assert.equal(await tick(), 'REQUESTED');
    assert.deepEqual((await state()).request_body, pendingBody, 'Busy delivery replays the exact durable request');
    await reply(409, {});
    await db.exec('update auto_register_cm_cron_state set retry_count=3');
    assert.equal(await tick(), 'DEFERRED');

    await reset('2026-10-26T13:19:59Z'); await tick();
    const pinnedBody = (await state()).request_body;
    await clock('2026-10-26T13:23:00Z');
    assert.equal(await tick(), 'REQUESTED', 'A missing response can be recovered after the timeout');
    assert.deepEqual((await state()).request_body, pinnedBody, 'The delivery window stays pinned across its boundary');
    await reply(200, { status: 'success', continuationToken: token });
    await db.exec('update auto_register_cm_cron_state set step_count=8');
    assert.equal(await tick(), 'DEFERRED', 'The independent driver also respects the eight-step cap');

    await reset('2026-10-26T13:47:00Z'); await tick();
    await clock('2026-10-26T14:06:00Z');
    assert.equal(await tick(), 'CHAIN_EXPIRED');
    await reset('2026-10-26T14:07:00Z'); await tick(); await reply(200, 'not JSON');
    assert.equal(await tick(), 'FAILED'); assert.equal((await state()).last_error_code, 'INVALID_RESPONSE');
    for (const role of ['anon','authenticated','service_role']) {
      assert.equal(await scalar("select has_function_privilege($1,'auto_register_cm_cron_tick()','EXECUTE')", [role]), false);
    }
    for (const role of ['anon','authenticated']) {
      assert.equal(await scalar("select has_table_privilege($1,'auto_register_cm_cron_state','SELECT')", [role]), false);
    }
    assert.equal(await scalar("select has_table_privilege('service_role','auto_register_cm_cron_state','SELECT')"), true);
    assert.equal(await scalar("select has_table_privilege('service_role','auto_register_cm_cron_state','UPDATE')"), false);
    await reset('2026-10-26T14:27:00Z');
    await db.exec('drop table vault.decrypted_secrets');
    const requestCount = (await requests()).length;
    assert.equal(await tick(), 'NOT_CONFIGURED');
    assert.equal((await state()).last_error_code, 'TRIGGER_DEPENDENCIES_MISSING');
    assert.equal(Date.parse((await state()).last_tick_at), Date.parse('2026-10-26T14:27:00Z'));
    assert.equal((await requests()).length, requestCount, 'Missing infrastructure never sends an unauthenticated request');
  } finally { await db.close(); }
});
