import test from 'node:test';
import assert from 'node:assert/strict';
import { recoveryRetrySetup } from '../src/services/northportRetry.js';
import { verifySchedulerRun } from '../server-handlers/northport/scheduler-verification.js';
import { createNorthportHandler } from '../server-handlers/northport/handler.js';
import { NORTHPORT_TARGET } from '../server-handlers/scheduler/targets.js';
import { ORIGIN, TASKS_URL } from '../server-handlers/scheduler/automation.js';
import type { Recovery } from '../src/types/northport.js';

test('retry restores saved EIR/window/mode while using the selected container and GP/EX type',()=>{
  for(const type of ['GP','EX'] as const) {
    const row={container:'SAVED123',container_type:type,search_setup:{unit:'OLD123',timestamp:'2026-10-21T00:01:00',type:'ALL',before:7,after:19,sourceFilename:'',mode:'files'}} as Recovery;
    assert.deepEqual(recoveryRetrySetup(row),{restored:true,setup:{...row.search_setup,unit:'SAVED123',type}});
  }
});

test('legacy retries use the exact saved source filename and clearly identify fallback settings',()=>{
  const row={container:'OLD123',container_type:'EX',source_filename:'CM_CONTAINER_20261021000130_EX.csv'} as Recovery;
  const result=recoveryRetrySetup(row);
  assert.equal(result.restored,false);assert.equal(result.setup.timestamp,'2026-10-21T00:01:30');
  assert.equal(result.setup.sourceFilename,row.source_filename);assert.equal(result.setup.type,'EX');
  assert.equal(result.setup.before,10);assert.equal(result.setup.after,30);
  assert.throws(()=>recoveryRetrySetup({...row,source_filename:'invalid'}),/Enter the container and EIR time/);
});

test('EX check reads Last run without triggering a task and closes the browser',async()=>{
  process.env.CARGOMOVE_USERNAME='test-only';process.env.CARGOMOVE_PASSWORD='test-only';
  const now=Date.now(),local=new Date(now+8*3600000);
  const displayed=`Today at ${local.getUTCHours()%12||12}:${String(local.getUTCMinutes()).padStart(2,'0')} ${local.getUTCHours()>=12?'PM':'AM'}`;
  let currentUrl='',closed=0;const destinations:string[]=[];let routeHandler:any;
  const field={fill:async()=>{},click:async()=>{}};
  const row={locator:()=>({nth:()=>({innerText:async()=>displayed})})};
  const link:any={first(){return this;},waitFor:async()=>{},locator:()=>row};
  const page:any={setDefaultTimeout(){},setDefaultNavigationTimeout(){},
    goto:async(url:string)=>{currentUrl=url;destinations.push(url);return {ok:()=>true};},url:()=>currentUrl,
    waitForNavigation:async()=>{currentUrl=ORIGIN+'/bookings';},
    locator:(selector:string)=>selector.startsWith('#scheduled_tasks')?link:{locator:()=>field,count:async()=>0},
  };
  const context:any={route:async(_pattern:string,handler:any)=>{routeHandler=handler;},newPage:async()=>page};
  const result=await verifySchedulerRun({...NORTHPORT_TARGET,before:'Yesterday at 12:00 AM',dispatchAt:now},async()=>({newContext:async()=>context,close:async()=>{closed++;}} as any));
  assert.equal(result.status,'ADVANCED');assert.equal(result.after,displayed);assert.equal(closed,1);
  assert.deepEqual(destinations,[ORIGIN,TASKS_URL]);
  let blocked=false;
  await routeHandler({request:()=>({url:()=>ORIGIN+'/administration/run_scheduled_task',method:()=> 'GET'}),abort:async()=>{blocked=true;},continue:async()=>{assert.fail('Scheduler execution must be blocked');}});
  assert.equal(blocked,true);
  assert.equal((await verifySchedulerRun({...NORTHPORT_TARGET,before:null,dispatchAt:now},async()=>{throw new Error('private-cookie');})).status,'UNAVAILABLE');
});

test('shared result endpoint routes EX to the associated scheduler audit, without GP, FTP or scheduler dispatch',async()=>{
  process.env.SCHEDULER_PORTAL_URL='https://portal.example.test';
  const id='10000000-0000-4000-8000-000000000001';let checks=0;const updates:any[]=[];
  const evidence={status:'ADVANCED',before:'Yesterday at 12:00 AM',after:'Today at 12:01 AM',observedAt:new Date().toISOString()} as const;
  const recovery={container_type:'EX',status:'Scheduler Triggered',scheduler_run_id:id};
  const run={dispatch_at:'2026-10-20T16:00:00Z',last_run_verification:{before:evidence.before},task_id:NORTHPORT_TARGET.taskId,scheduler:NORTHPORT_TARGET.workerName};
  const client:any={rpc:async(name:string)=>{assert.equal(name,'northport_admit_request');return {data:true};},from:(table:string)=>{const query:any={select(){return this;},eq(){return this;},timeout(){return this;},update(value:any){updates.push(value);return this;},maybeSingle:async()=>({data:table==='user_registrations'?{id}:table==='cargomove_scheduler_runs'?run:recovery}),then:(resolve:any)=>Promise.resolve({error:null}).then(resolve)};return query;}};
  const handler=createNorthportHandler({adminClient:()=>client,readSession:()=>({id,email:'admin@example.test',type:'ADMIN'}),verifySchedulerRun:async(input:any)=>{checks++;assert.equal(input.taskId,NORTHPORT_TARGET.taskId);assert.equal(input.before,evidence.before);return evidence;},verifyGatepass:async()=>{assert.fail('EX cannot use GP verification');},withFtp:async()=>{assert.fail('No FTP');},runScheduler:async()=>{assert.fail('No dispatch');}} as any);
  const response:any={code:200,setHeader(){},status(code:number){this.code=code;return this;},json(body:any){this.body=body;return this;}};
  await handler({method:'POST',headers:{origin:'https://portal.example.test','x-cargomove-confirm':'northport-recovery'},body:{action:'verify-result',id}},response);
  assert.equal(response.code,200);assert.equal(response.body.status,'Import Verified');assert.equal(checks,1);
  assert.deepEqual(updates,[{last_run_verification:evidence}]);
});
