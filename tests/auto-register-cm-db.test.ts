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
      create table public.registration_submissions(
        id text primary key,registration_type text,status text,cargomove_upload jsonb,
        reference_no text,company_name text,submitted_at timestamptz default now(),
        data jsonb default '{}'::jsonb,company_id text,port_id text,port_location text,depot_id text,company_reg_no text
      );
      create table public.companies(
        id text primary key,registration_status text,haulier_id text,forwarding_agent_id text,updated_at timestamptz default now()
      );
      create table public.port_configs(
        id text primary key,backend_port_id text,location text,code text,display_name text,active boolean default true,updated_at timestamptz default now()
      );
      create table public.depot_configs(
        id text primary key,backend_depot_id text,active boolean default true,updated_at timestamptz default now()
      );
      insert into auth.users(id,email) values('${actor}','admin@example.test'),('${revoked}','revoked@example.test');
      insert into public.user_registrations values('ADMIN@EXAMPLE.TEST','ADMIN'),('revoked@example.test','COMPANY_ADMIN');`);
    await db.exec(readFileSync(new URL('../supabase/migrations/20261025030000_auto_register_cm_scheduler.sql', import.meta.url), 'utf8'));
    await db.exec(readFileSync(new URL('../supabase/migrations/20261025040000_auto_register_cm_queue.sql', import.meta.url), 'utf8'));
    await db.exec(readFileSync(new URL('../supabase/migrations/20261025050000_auto_register_cm_execution_reference.sql', import.meta.url), 'utf8'));
    await db.exec('alter table auto_register_cm_scheduled_items drop column registration_fingerprint');
    await db.exec(readFileSync(new URL('../supabase/migrations/20261025060000_auto_register_cm_hardening.sql', import.meta.url), 'utf8'));
    await db.exec(readFileSync(new URL('../supabase/migrations/20261025070000_auto_register_cm_reliability.sql', import.meta.url), 'utf8'));
    const scalar = async (sql: string, params: unknown[] = []) => Object.values((await db.query<any>(sql, params)).rows[0])[0] as any;
    const acquire = (type: 'AUTOMATIC' | 'MANUAL', key: string | null, who = actor) => scalar(
      'select acquire_automation_scheduler($1,$2,$3,$4)', ['auto_register_cm', type, who, key]);

    assert.equal(await scalar("select is_enabled from automation_schedulers where scheduler_key='auto_register_cm'"), false);
    assert.deepEqual(await scalar('select auto_register_cm_actor()'), { id: actor, email: 'admin@example.test' });
    const disabled = await acquire('AUTOMATIC', 'window-1');
    assert.equal(disabled.reason, 'disabled');
    assert.equal(await scalar('select status from automation_scheduler_runs where id=$1', [disabled.id]), 'SKIPPED');
    assert.match(await scalar('select execution_reference from automation_scheduler_runs where id=$1', [disabled.id]), /^AUTOREG\d{7}$/);

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

    await db.exec(`insert into companies(id,registration_status,haulier_id) values('company-1','DONE','haulier-1');
      insert into port_configs(id,backend_port_id) values('port-1','aaaaaaaaaaaaaaaaaaaaaaaa');`);
    await db.query(`insert into registration_submissions(id,registration_type,status,reference_no,company_name,company_id,port_id)
      values('asset-1','VEHICLE','PENDING','CMREG400001','Example Logistics','company-1','port-1')`);
    const queue = await db.query<any>('select * from schedule_auto_register_cm_submissions($1,$2)', [actor, ['asset-1']]);
    assert.equal(queue.rows.length, 1);
    assert.equal(queue.rows[0].status, 'SCHEDULED');
    assert.equal(queue.rows[0].reference_no, 'CMREG400001');
    await db.query("update auto_register_cm_scheduled_items set run_id=$1 where submission_id='asset-1'", [first.id]);
    assert.equal(
      await scalar(`select r.execution_reference || ' - ' || q.reference_no
        from auto_register_cm_scheduled_items q join automation_scheduler_runs r on r.id=q.run_id
        where q.submission_id='asset-1'`),
      `${await scalar('select execution_reference from automation_scheduler_runs where id=$1', [first.id])} - CMREG400001`,
    );
    assert.equal((await db.query<any>('select * from schedule_auto_register_cm_submissions($1,$2)', [actor, ['asset-1']])).rows.length, 1,
      'Scheduling an already queued registration is idempotent');
    await db.exec("update auto_register_cm_scheduled_items set status='FAILED',completed_at=now() where submission_id='asset-1'");
    assert.equal((await db.query<any>('select * from schedule_auto_register_cm_submissions($1,$2)', [actor, ['asset-1']])).rows.length, 0,
      'The same failed registration is not automatically retried without changes');
    await db.exec("update companies set haulier_id='haulier-2',updated_at=now()+interval '1 second' where id='company-1'");
    assert.equal((await db.query<any>('select * from schedule_auto_register_cm_submissions($1,$2)', [actor, ['asset-1']])).rows.length, 1,
      'A corrected registration dependency can be automatically scheduled again');
    assert.equal(await scalar('select count(*)::integer from automation_scheduler_run_items where run_id=$1', [first.id]), 1,
      'Execution-to-registration history is retained separately from the latest run pointer');
    await db.exec("update registration_submissions set status='DONE' where id='asset-1'");
    await assert.rejects(
      () => db.query('select * from schedule_auto_register_cm_submissions($1,$2)', [actor, ['asset-1']]),
      /no longer eligible/,
    );
    assert.equal(await scalar("select has_function_privilege('authenticated','public.schedule_auto_register_cm_submissions(uuid,text[])','EXECUTE')"), false);
    assert.equal(await scalar("select has_function_privilege('service_role','public.schedule_auto_register_cm_submissions(uuid,text[])','EXECUTE')"), true);
  } finally { await db.close(); }
});

test('populated upgrades preserve failed retry guards, legacy writes, stable dependency hashes and every run association', async () => {
  for (const missingFingerprint of [false, true]) {
    const db = new PGlite();
    const actor = '10000000-0000-4000-8000-000000000001';
    const scalar = async (sql: string, params: unknown[] = []) => Object.values((await db.query<any>(sql, params)).rows[0])[0] as any;
    const migrate = async (name: string) => db.exec(readFileSync(new URL('../supabase/migrations/' + name, import.meta.url), 'utf8'));
    try {
      await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
        create schema auth;
        create table auth.users(id uuid primary key,email text,created_at timestamptz default now());
        create table user_registrations(email text,type text);
        create table companies(id text primary key,registration_status text,haulier_id text,forwarding_agent_id text,updated_at timestamptz default now());
        create table port_configs(id text primary key,location text,code text,display_name text,backend_port_id text,active boolean default true,updated_at timestamptz default now());
        create table depot_configs(id text primary key,backend_depot_id text,active boolean default true,updated_at timestamptz default now());
        create table registration_submissions(id text primary key,registration_type text,status text,cargomove_upload jsonb,
          reference_no text,company_name text,submitted_at timestamptz default now(),data jsonb default '{}',
          company_id text,port_id text,port_location text,depot_id text,company_reg_no text);
        insert into auth.users(id,email) values('${actor}','admin@example.test');
        insert into user_registrations values('admin@example.test','ADMIN');
        insert into companies(id,registration_status,haulier_id) values('c','DONE','H1');
        insert into port_configs(id,location,code,backend_port_id) values
          ('pk-westport','PORT_KLANG','WESTPORT','aaaaaaaaaaaaaaaaaaaaaaaa'),
          ('pk-northport','PORT_KLANG','NORTHPORT','bbbbbbbbbbbbbbbbbbbbbbbb');
        insert into registration_submissions(id,registration_type,status,reference_no,company_name,company_id,port_id,port_location)
          values('legacy','VEHICLE','PENDING','CMREG1','Fixture','c','pk-westport','PORT_KLANG'),
            ('hardening','VEHICLE','PENDING','CMREG2','Fixture','c','pk-westport','PORT_KLANG');`);
      await migrate('20261025030000_auto_register_cm_scheduler.sql');
      await migrate('20261025040000_auto_register_cm_queue.sql');
      await migrate('20261025050000_auto_register_cm_execution_reference.sql');
      await db.query('select * from schedule_auto_register_cm_submissions($1,$2)', [actor, ['legacy']]);
      await db.exec("update auto_register_cm_scheduled_items set status='FAIL',completed_at=now() where submission_id='legacy'");
      if (missingFingerprint) await db.exec('alter table auto_register_cm_scheduled_items drop column registration_fingerprint');
      await migrate('20261025060000_auto_register_cm_hardening.sql');
      await db.query('select * from schedule_auto_register_cm_submissions($1,$2)', [actor, ['hardening']]);
      await db.exec("update auto_register_cm_scheduled_items set status='FAILED',completed_at=now() where submission_id='hardening'");
      const originalFingerprints = (await db.query('select id,registration_fingerprint from auto_register_cm_scheduled_items order by id')).rows;
      await migrate('20261025070000_auto_register_cm_reliability.sql');
      assert.deepEqual((await db.query('select id,registration_fingerprint from auto_register_cm_scheduled_items order by id')).rows, originalFingerprints,
        'Upgrade preserves original audit fingerprints');
      assert.equal((await db.query('select * from schedule_auto_register_cm_submissions($1,$2)', [actor, ['legacy', 'hardening']])).rows.length, 0,
        'Neither legacy nor hardening-era unchanged failures requeue during upgrade');
      assert.equal((await db.query('select * from auto_register_cm_pending_page(null,100,true)')).rows.length, 0);

      await db.exec("set timezone='UTC'");
      const utc = await scalar("select auto_register_cm_registration_fingerprint('legacy')");
      await db.exec("set timezone='Asia/Kuala_Lumpur'");
      assert.equal(await scalar("select auto_register_cm_registration_fingerprint('legacy')"), utc);
      await db.exec("update companies set updated_at=now()+interval '1 minute'; update port_configs set updated_at=now()+interval '2 minutes'");
      assert.equal(await scalar("select auto_register_cm_registration_fingerprint('legacy')"), utc,
        'Timestamp-only changes do not allow duplicate retries');
      await db.exec("update port_configs set backend_port_id='cccccccccccccccccccccccc' where id='pk-northport'");
      assert.notEqual(await scalar("select auto_register_cm_registration_fingerprint('legacy')"), utc,
        'Correcting Northport changes the retry fingerprint even when port_id points at Westport');
      const queued = await db.query<any>('select * from schedule_auto_register_cm_submissions($1,$2)', [actor, ['legacy']]);
      assert.equal(queued.rows.length, 1);

      const first = await scalar('select acquire_automation_scheduler($1,$2,$3,null)', ['auto_register_cm', 'MANUAL', actor]);
      await db.query('update auto_register_cm_scheduled_items set run_id=$1 where id=$2', [first.id, queued.rows[0].id]);
      await db.query("select finish_automation_scheduler($1,'SUCCESS',1,0,0,'Processing',null)", [first.id]);
      const second = await scalar('select acquire_automation_scheduler($1,$2,$3,null)', ['auto_register_cm', 'MANUAL', actor]);
      await db.query('update auto_register_cm_scheduled_items set run_id=$1 where id=$2', [second.id, queued.rows[0].id]);
      await db.exec('set role service_role');
      await db.query("update auto_register_cm_scheduled_items set status='FAIL',completed_at=now() where id=$1", [queued.rows[0].id]);
      await db.exec('reset role');
      assert.equal(await scalar('select status from auto_register_cm_scheduled_items where id=$1', [queued.rows[0].id]), 'FAILED');
      const associations = (await db.query<any>('select run_id,queue_status from automation_scheduler_run_items where scheduled_item_id=$1 order by linked_at', [queued.rows[0].id])).rows;
      assert.equal(associations.length, 2);
      assert.ok(associations.some(row => row.run_id === first.id && row.queue_status === 'SCHEDULED'));
      assert.ok(associations.some(row => row.run_id === second.id && row.queue_status === 'FAILED'));
      for (const role of ['anon', 'authenticated']) {
        assert.equal(await scalar(`select has_function_privilege($1,'public.auto_register_cm_pending_page(text,integer,boolean)','EXECUTE')`, [role]), false);
        assert.equal(await scalar(`select has_table_privilege($1,'public.automation_scheduler_run_items','SELECT')`, [role]), false);
      }
      await db.exec(`insert into registration_submissions(id,registration_type,status,reference_no,company_name,company_id,port_id,port_location)
        select 'scan-'||lpad(n::text,4,'0'),'DRIVER','PENDING','CMREGSCAN'||n,'Fixture','c','pk-westport','PORT_KLANG'
        from generate_series(1,351) n;
        update registration_submissions set cargomove_upload='{"state":"SUCCESS"}' where id='scan-0001'`);
      let after: string | null = null;
      const seen = new Set<string>();
      while (true) {
        const page = (await db.query<any>('select * from auto_register_cm_pending_page($1,1000,true)', [after])).rows;
        assert.ok(page.length <= 100, 'Database enforces a bounded page even with a larger client limit');
        for (const row of page) {
          assert.equal(seen.has(row.id), false);
          seen.add(row.id);
        }
        if (!page.length) break;
        after = page[page.length - 1].id;
      }
      assert.equal([...seen].filter(id => id.startsWith('scan-')).length, 350);
      assert.equal(seen.has('scan-0001'), false, 'Already verified uploads cannot consume discovery pages');
      assert.equal(seen.has('scan-0351'), true, 'Database pagination reaches registrations beyond the old cap');
    } finally { await db.close(); }
  }
});
