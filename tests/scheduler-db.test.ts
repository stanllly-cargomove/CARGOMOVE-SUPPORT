import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

test('30-second scheduler migration keeps global admission, legacy callers, administrator checks and uncertain-run protection',async()=>{
  const db=new PGlite();
  const actor='10000000-0000-4000-8000-000000000001';
  const revoked='10000000-0000-4000-8000-000000000002';
  const northport='00000000-0000-4000-8000-000000000005';
  const other='00000000-0000-4000-8000-000000000006';
  try {
    await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
      create schema auth;create table auth.users(id uuid primary key,email text);
      create table public.user_registrations(email text,type text);
      insert into auth.users values('${actor}','ADMIN@EXAMPLE.TEST'),('${revoked}','revoked@example.test');
      insert into public.user_registrations values('admin@example.test','ADMIN'),('revoked@example.test','COMPANY_ADMIN');`);
    for(const file of ['20261016000000_cargomove_scheduler.sql','20261017000000_cargomove_scheduler_gallery.sql','20261017020000_scheduler_cooldown_45_seconds.sql','20261021000000_scheduler_verification_30_seconds.sql']){
      await db.exec(readFileSync(new URL('../supabase/migrations/'+file,import.meta.url),'utf8'));
    }
    await db.query(`insert into cargomove_schedulers(id,display_name,task_id,worker_name) values($1,'Other task','5ff7ea8633904c1dd1bd892c','other_task')`,[other]);
    const scalar=async(sql:string,params:unknown[]=[])=>Object.values((await db.query<any>(sql,params)).rows[0])[0] as any;
    const acquire=(target=northport,who=actor)=>scalar('select acquire_saved_cargomove_scheduler($1,$2)',[who,target]);
    await assert.rejects(()=>acquire(northport,revoked),/Administrator required/);
    const first=await acquire();assert.ok(first.id);
    await db.query("update cargomove_scheduler_runs set status='TRIGGER_REQUESTED',finished_at=now(),requested_at=now()-interval '29 seconds'");
    const blocked=await acquire(other);assert.deepEqual(blocked,{reason:'cooldown',cooldown_seconds:30});
    assert.equal((await scalar('select acquire_cargomove_scheduler($1)',[actor])).reason,'cooldown','Legacy caller uses the same cooldown');
    await db.query("update cargomove_scheduler_runs set requested_at=now()-interval '31 seconds'");
    const second=await acquire(other);assert.ok(second.id,'A different scheduler may run after 30 seconds');
    await db.exec('begin');
    await db.query("update cargomove_scheduler_runs set status='FAILED',finished_at=now(),requested_at=now()-interval '30 seconds'");
    assert.ok((await scalar('select acquire_cargomove_scheduler($1)',[actor])).id,'Exactly 30 seconds is admitted, including after failure');
    await db.exec('commit');
    await db.query("update cargomove_scheduler_runs set status='COMPLETED',requested_at=now()-interval '10 minutes'");
    await db.query("update cargomove_scheduler_runs set status='RUNNING',lease_until=now()+interval '1 minute' where id=$1",[first.id]);
    assert.equal((await acquire()).reason,'running','A live task still blocks admission after cooldown');
    await db.query("update cargomove_scheduler_runs set lease_until=now()-interval '1 second' where id=$1",[first.id]);
    assert.equal((await acquire()).reason,'unknown','Expired leases require operator resolution');
    assert.equal(await scalar('select status from cargomove_scheduler_runs where id=$1',[first.id]),'UNKNOWN');
    assert.equal(await scalar("select has_function_privilege('authenticated','public.acquire_saved_cargomove_scheduler(uuid,uuid)','EXECUTE')"),false);
    assert.equal(await scalar("select has_function_privilege('service_role','public.acquire_saved_cargomove_scheduler(uuid,uuid)','EXECUTE')"),true);
    assert.equal(await scalar('select count(*)::int from cargomove_scheduler_runs'),3,'Historical audit records remain');
  }finally{await db.close();}
});
