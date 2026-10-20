import test from 'node:test';
import assert from 'node:assert/strict';
import { matchGatepass, verifyGatepass, NORTHPORT_PORT_ID } from '../server-handlers/northport/gatepass-verification.js';
import { createNorthportHandler } from '../server-handlers/northport/handler.js';
import { recoveryFlow } from '../src/services/northportRecoveryStatus.js';

const dispatch=Date.parse('2026-10-20T16:01:00Z');
const gatepass='000123-GP', container='MSBU4179350';
const row=(offset=0)=>({id:gatepass,container,t:{updated:new Date(dispatch+offset).toISOString()}});

test('GP success requires the exact pair, preserving gatepass punctuation and leading zeros',()=>{
  assert.equal(matchGatepass([{...row(),id:'000124-GP'}],gatepass,container,dispatch),null);
  assert.equal(matchGatepass([{...row(),container:'MSBU4179351'}],gatepass,container,dispatch),null);
  assert.equal(matchGatepass([row()],'123-GP',container,dispatch),null);
  assert.equal(matchGatepass([row()],'000123',container,dispatch),null);
  assert.equal(matchGatepass([row()],'',container,dispatch),null);
  assert.equal(matchGatepass([{...row(),id:'OTHER-GP'},row()],gatepass,' msbu4179350 ',dispatch)?.status,'VERIFIED');
});

test('Updated uses inclusive ±2 minutes across Malaysia midnight and never overrides an exact pair match',()=>{
  for(const offset of [-120001,-120000,0,120000,120001]) {
    const evidence=matchGatepass([row(offset)],gatepass,container,dispatch)!;
    assert.equal(evidence.status,'VERIFIED');
    assert.equal(evidence.updatedWithinTolerance,Math.abs(offset)<=120000);
  }
  assert.equal(matchGatepass([{id:gatepass,container}],gatepass,container,dispatch)?.updatedWithinTolerance,null);
  assert.equal(matchGatepass([row()],gatepass,container,null)?.updatedWithinTolerance,null);
  assert.equal(matchGatepass([{...row(),t:{updated:'Yesterday'}}],gatepass,container,dispatch)?.updatedAt,null);
});

test('read-only lookup selects Northport, searches gatepass, checks pagination and closes without dispatch',async()=>{
  process.env.CARGOMOVE_USERNAME='test-only';process.env.CARGOMOVE_PASSWORD='test-only';
  let currentUrl='',closed=0;
  let mode:'match'|'wrong-pair'|'malformed'|'http-error' = 'match';
  const forms:any[]=[];
  const page:any={
    setDefaultTimeout(){},setDefaultNavigationTimeout(){},
    goto:async(url:string)=>{currentUrl=url;return {ok:()=>true};},url:()=>currentUrl,
    waitForNavigation:async()=>{currentUrl='https://www.cargomove.my/bookings';},
    locator:(selector:string)=>({locator:()=>({fill:async()=>{},click:async()=>{}}),count:async()=>0,selectOption:async(value:string)=>{assert.equal(selector,'#NameofPort');assert.equal(value,NORTHPORT_PORT_ID);}}),
    waitForTimeout:async()=>{},
  };
  let routeHandler:any;
  const context:any={route:async(_pattern:string,handler:any)=>{routeHandler=handler;},newPage:async()=>page,request:{post:async(url:string,options:any)=>{
    assert.equal(url,'https://www.cargomove.my/bookings/gatepasses_list_ajax');
    assert.equal(options.maxRedirects,0);assert.equal(options.maxRetries,0);
    assert.equal(options.form.port,NORTHPORT_PORT_ID);assert.equal(options.form['search[value]'],gatepass);
    forms.push(options.form);
    return {ok:()=>mode!=='http-error',json:async()=>mode==='malformed'?{}:mode==='wrong-pair'?{recordsFiltered:1,data:[{...row(),id:'OTHER-GP'}]}:{recordsFiltered:51,data:options.form.start===0?[{...row(),id:'OTHER-GP'}]:[row()]}};
  }}};
  const result=await verifyGatepass({gatepass,container,dispatchAt:dispatch},async()=>({newContext:async()=>context,close:async()=>{closed++;}} as any));
  assert.equal(result.status,'VERIFIED');assert.deepEqual(forms.map(f=>f.start),[0,50]);assert.equal(closed,1);
  let blocked=false;
  await routeHandler({request:()=>({url:()=> 'https://www.cargomove.my/administration/run_scheduled_task?id=anything',method:()=> 'GET'}),abort:async()=>{blocked=true;},continue:async()=>{throw new Error('Dispatch must be blocked');}});
  assert.equal(blocked,true);
  for (const scenario of ['wrong-pair','malformed','http-error'] as const) {
    mode=scenario;
    const result=await verifyGatepass({gatepass,container,dispatchAt:dispatch},async()=>({newContext:async()=>context,close:async()=>{closed++;}} as any));
    assert.equal(result.status,scenario==='wrong-pair'?'NOT_FOUND':'UNAVAILABLE');
  }
  assert.equal(closed,4,'Every lookup closes its browser, including failed and empty searches');
});

test('lookup failures remain unavailable and never expose launch errors',async()=>{
  const result=await verifyGatepass({gatepass,container,dispatchAt:dispatch},async()=>{throw new Error('private-token');});
  assert.equal(result.status,'UNAVAILABLE');assert.ok(!JSON.stringify(result).includes('private-token'));
});

test('verification API trusts saved GP identity, skips EX, requires upload, persists evidence and never runs scheduler or FTP',async()=>{
  process.env.SCHEDULER_PORTAL_URL='https://portal.example.test';
  const id='10000000-0000-4000-8000-000000000001';
  let recovery:any={container,container_type:'GP',status:'Scheduler Triggered',approved_values:[container,gatepass,...Array(18).fill('')],scheduler_run_id:id};
  let lookups=0;let verifiedResult=true;const updates:any[]=[];
  const client:any={
    rpc:async(name:string)=>{assert.equal(name,'northport_admit_request');return {data:true};},
    from:(table:string)=>{let columns='';const query:any={select(value:string){columns=value;return this;},eq(){return this;},neq(){return this;},timeout(){return this;},update(value:any){updates.push(value);return this;},maybeSingle:async()=>({data:table==='cargomove_scheduler_runs'?{dispatch_at:new Date(dispatch).toISOString()}:columns==='id'?{id}:recovery}),then:(resolve:any)=>Promise.resolve({error:null}).then(resolve)};return query;},
  };
  const handler=createNorthportHandler({adminClient:()=>client,readSession:()=>({id,email:'admin@example.test',type:'ADMIN'}),withFtp:async()=>{throw new Error('Must not use FTP');},runScheduler:async()=>{throw new Error('Must not dispatch');},verifyGatepass:async(expected:any)=>{lookups++;assert.deepEqual(expected,{gatepass,container,dispatchAt:dispatch});return {...matchGatepass([row()],gatepass,container,dispatch)!,status:verifiedResult?'VERIFIED':'NOT_FOUND'};}} as any);
  const call=async()=>{const response:any={code:200,setHeader(){},status(code:number){this.code=code;return this;},json(body:any){this.body=body;return this;}};await handler({method:'POST',headers:{origin:'https://portal.example.test','x-cargomove-confirm':'northport-recovery'},body:{action:'verify-gp',id,gatepass:'UNTRUSTED',container:'UNTRUSTED'}},response);return response;};
  const result=await call();assert.equal(result.body.status,'Import Verified');assert.equal(updates[0].gp_verification.gatepass,gatepass);assert.equal(updates[0].status,'Import Verified');
  assert.equal(recoveryFlow({...recovery,gp_verification:result.body.gpVerification}).label,'SUCCESS');
  recovery={...recovery,container_type:'EX'};assert.equal((await call()).body.status,'Not Applicable');assert.equal(lookups,1);
  recovery={...recovery,container_type:'GP',status:'Approved'};assert.equal((await call()).code,409);assert.equal(lookups,1);
  verifiedResult=false;recovery={...recovery,status:'Scheduler Triggered'};
  const missing=await call();assert.equal(missing.body.status,'Verification Failed');assert.match(missing.body.message,/not found after processing/);
  assert.equal(recoveryFlow({...recovery,gp_verification:missing.body.gpVerification}).label,'FAIL');
  assert.equal(updates.at(-1).status,undefined,'A negative lookup preserves the uploaded audit stage');
});
