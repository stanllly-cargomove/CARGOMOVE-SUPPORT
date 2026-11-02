import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { launchAccountBrowser, CargoMoveAccountBusyError } from '../server-handlers/scheduler/account-session.js';

test('shared login lease blocks another browser, releases after close and cleans up launch failures',async()=>{
  let holder:string|null=null;let next=0;let launches=0;
  const client={rpc:async(name:string,args:any)=>{
    if(name==='acquire_cargomove_account_session') {
      if(holder)return {data:{reason:'busy'}};
      holder=String(++next);return {data:{id:holder}};
    }
    if(holder===args.p_id)holder=null;
    return {data:true};
  }};
  const launch=async()=>{
    launches++;const events=new EventEmitter();
    return Object.assign(events,{newContext:async()=>{},close:async()=>{events.emit('disconnected');}}) as any;
  };
  const first=await launchAccountBrowser(client,launch);
  await assert.rejects(()=>launchAccountBrowser(client,launch),CargoMoveAccountBusyError);
  assert.equal(launches,1,'A concurrent request cannot create another login');
  await first.close();assert.equal(holder,null);
  const second=await launchAccountBrowser(client,launch);await second.close();
  await assert.rejects(()=>launchAccountBrowser(client,async()=>{throw new Error('launch failed');}),/launch failed/);
  assert.equal(holder,null);
  await assert.rejects(()=>launchAccountBrowser({rpc:async()=>({error:{message:'unavailable'}})},launch),/session protection is unavailable/);
  assert.equal(launches,2);
});

test('database coordination protects shared sessions and retries only scheduler failures before dispatch',async()=>{
  const db=new PGlite();const actor='10000000-0000-4000-8000-000000000001';const id='20000000-0000-4000-8000-000000000001';
  try {
    await db.exec(`create role anon;create role authenticated;create role service_role;
      create schema auth;create table auth.users(id uuid,email text);create table user_registrations(email text,type text);
      insert into auth.users values('${actor}','admin@example.test');insert into user_registrations values('admin@example.test','ADMIN');
      create table cargomove_scheduler_runs(id uuid primary key,status text,dispatch_at timestamptz);
      create table northport_recoveries(id uuid primary key,status text,scheduler_status text,scheduler_run_id uuid);
      insert into northport_recoveries values('${id}','Uploaded',null,null);`);
    const sql=readFileSync(new URL('../supabase/migrations/20261102030000_cargomove_session_coordination.sql',import.meta.url),'utf8');
    await db.exec(sql);await db.exec(sql);
    const scalar=async(query:string,args:any[]=[])=>Object.values((await db.query<any>(query,args)).rows[0])[0] as any;
    const acquire=()=>scalar('select acquire_cargomove_account_session()');
    const first=await acquire();assert.ok(first.id);
    assert.equal((await acquire()).reason,'busy','Same and different portal users share one lease');
    await db.exec("update cargomove_account_session set lease_until=now()-interval '1 second'");
    const next=await acquire();assert.notEqual(next.id,first.id);
    assert.equal(await scalar('select release_cargomove_account_session($1)',[first.id]),false,'An expired holder cannot release another session');
    assert.equal((await acquire()).reason,'busy');
    assert.equal(await scalar('select release_cargomove_account_session($1)',[next.id]),true);
    const competing=await Promise.all([acquire(),acquire()]);
    assert.equal(competing.filter(value=>value.id).length,1);assert.equal(competing.filter(value=>value.reason==='busy').length,1);
    await scalar('select release_cargomove_account_session($1)',[competing.find(value=>value.id).id]);
    const claim=()=>scalar('select northport_claim_scheduler($1,$2)',[id,actor]);
    assert.equal(await claim(),true);assert.equal(await claim(),false,'Two tabs cannot both claim dispatch');
    await db.exec(`insert into cargomove_scheduler_runs values('${id}','FAILED',null);
      update northport_recoveries set status='Verification Unavailable',scheduler_status='failed',scheduler_run_id='${id}'`);
    assert.equal(await claim(),true,'Existing pre-dispatch failure can retry without FTP');
    assert.equal(await claim(),false);
    await db.exec("update northport_recoveries set scheduler_status='failed';update cargomove_scheduler_runs set dispatch_at=now()");
    assert.equal(await claim(),false,'A sent request is never automatically reclaimed');
    await db.exec("update northport_recoveries set scheduler_status='unknown'");assert.equal(await claim(),false);
    await db.exec("update northport_recoveries set scheduler_status='not_sent'");assert.equal(await claim(),true);
    for(const role of ['anon','authenticated']) {
      assert.equal(await scalar(`select has_function_privilege('${role}','public.acquire_cargomove_account_session()','EXECUTE')`),false);
      assert.equal(await scalar(`select has_table_privilege('${role}','public.cargomove_account_session','SELECT')`),false);
    }
  } finally {await db.close();}
});
