import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { containerUpdatedTimestamp, matchExportContainer, verifyExportContainer } from '../server-handlers/northport/export-verification.js';
import { createNorthportHandler } from '../server-handlers/northport/handler.js';
import { recoveryFlow } from '../src/services/northportRecoveryStatus.js';

const dispatchAt=Date.parse('2026-11-17T02:36:54Z'),observedAt=dispatchAt+300000;
const expected={container:'CSNU6170072',scn:'26ALUF',dispatchAt};
const row=['1','EXPORT',expected.container,'Northport',expected.scn,'40 GP','1','2026-11-17 10:36:54','-'];

test('export success requires exact ID, SCN, EXPORT and Northport on the same fresh row',()=>{
  assert.equal(matchExportContainer([row],expected,observedAt).status,'VERIFIED');
  for(const [column,value] of [[1,'IMPORT'],[1,'DROP'],[2,'CSNU61700720'],[3,'Westports'],[4,'26ALU']] as const){
    const wrong=[...row];wrong[column]=value;
    assert.equal(matchExportContainer([wrong],expected,observedAt).status,'NOT_FOUND');
  }
  const otherScn=[...row];otherScn[4]='OTHER';
  const otherContainer=[...row];otherContainer[2]='OTHER';
  assert.equal(matchExportContainer([otherScn,otherContainer],expected,observedAt).status,'NOT_FOUND');
  assert.equal(matchExportContainer([row],{...expected,container:' csnu6170072 ',scn:' 26aluf '},observedAt).status,'VERIFIED');
  assert.equal(matchExportContainer([row],{...expected,scn:''},observedAt).status,'UNAVAILABLE');
});

test('export Updated is mandatory and uses Malaysia time, clock tolerance and no future timestamps',()=>{
  assert.equal(containerUpdatedTimestamp('2026-11-17 10:36:54'),dispatchAt);
  for(const value of ['2026-02-30 10:36:54','2026-11-17 25:36:54','Yesterday','', '2026-11-17T10:36:54Z'])assert.equal(containerUpdatedTimestamp(value),null);
  for(const [updated,status] of [['2026-11-17 10:34:53','STALE'],['2026-11-17 10:34:54','VERIFIED'],['2026-11-17 10:41:54','VERIFIED'],['2026-11-17 10:41:55','UNAVAILABLE'],['-','UNAVAILABLE']] as const){
    const record=[...row];record[7]=updated;
    assert.equal(matchExportContainer([record],expected,observedAt).status,status);
  }
  assert.equal(containerUpdatedTimestamp('2026-11-18 00:00:00'),Date.parse('2026-11-17T16:00:00Z'));
});

test('read-only export lookup logs in, submits the real form and parses the exact table without external requests',async()=>{
  process.env.CARGOMOVE_USERNAME='offline-user';process.env.CARGOMOVE_PASSWORD='offline-password';
  const browser=await chromium.launch({channel:'chrome',headless:true});
  let closed=0,searches=0;let routeGuard:any;
  const launch=async()=>({newContext:async(options:any)=>{
    const context=await browser.newContext(options);
    return {route:async(_pattern:string,guard:any)=>{routeGuard=guard;},newPage:async()=>{
      const page=await context.newPage();
      await page.route('**/*',route=>{
        const request=route.request(),url=new URL(request.url());
        assert.equal(url.origin,'https://www.cargomove.my');
        const form='<form action="containers" method="post"><input name="container"><input name="booking_reference"><button type="submit">Search now</button></form>';
        if(url.pathname==='/')return route.fulfill({contentType:'text/html',body:'<form action="https://www.cargomove.my/user/login" method="post"><input id="materialFormUsername"><input id="materialFormLoginPasswordEx" type="password"><button type="submit">Login</button></form>'});
        if(url.pathname==='/user/login')return route.fulfill({contentType:'text/html',body:'Logged in'});
        assert.equal(url.pathname,'/administration/containers');
        if(request.method()==='GET')return route.fulfill({contentType:'text/html',body:form});
        assert.equal(request.method(),'POST');searches++;
        const body=new URLSearchParams(request.postData()!);
        assert.equal(body.get('container'),expected.container);assert.equal(body.get('booking_reference'),'');
        // First read is stale; the second contains a fresh matching row.
        const record=[...row];record[7]=searches===1?'2021-05-29 19:12:22':row[7];
        const headers=['#','Type','ID','Location','SCN / Op.','Type size','Booked / Total','Updated','Expiry'];
        return route.fulfill({contentType:'text/html',body:form+`<table><thead><tr>${headers.map(h=>`<th>${h}</th>`).join('')}</tr></thead><tbody><tr>${record.map(v=>`<td>${v}</td>`).join('')}</tr></tbody></table>`});
      });
      return page;
    }};
  },close:async()=>{closed++;}} as any);
  try {
    assert.equal((await verifyExportContainer(expected,launch)).status,'VERIFIED');
    assert.equal(searches,2);assert.equal(closed,1);
    for(const [url,method] of [['https://www.cargomove.my/administration/run_scheduled_task','GET'],['https://www.cargomove.my/administration/delete','POST'],['https://outside.test','GET']]){
      let blocked=false;
      await routeGuard({request:()=>({url:()=>url,method:()=>method}),abort:async()=>{blocked=true;},continue:async()=>assert.fail('Mutation/external request permitted')});
      assert.equal(blocked,true);
    }
    const unavailable=await verifyExportContainer(expected,async()=>{throw new Error('private-cookie');});
    assert.equal(unavailable.status,'UNAVAILABLE');assert.ok(!JSON.stringify(unavailable).includes('private-cookie'));
  } finally {await browser.close();}
});

test('export endpoint uses approved ID/SCN and saved dispatch, persists separate evidence and preserves concurrent success',async()=>{
  process.env.SCHEDULER_PORTAL_URL='https://portal.example.test';
  const id='10000000-0000-4000-8000-000000000001';
  const values=Array(20).fill('');values[0]=expected.container;values[9]=expected.scn;
  let recovery:any={container:expected.container,container_type:'EX',status:'Scheduler Triggered',scheduler_run_id:id,approved_values:values};
  let evidence=matchExportContainer([row],expected,observedAt),lookups=0,schemaMissing=false,dispatchMissing=false;
  const updates:any[]=[],guards:string[]=[];
  const client:any={rpc:async()=>({data:true}),from:(table:string)=>{
    let columns='';
    const query:any={select(value:string){columns=value;return this;},eq(){return this;},neq(_column:string,value:string){guards.push(value);return this;},timeout(){return this;},update(value:any){assert.equal(table,'northport_recoveries');updates.push(value);return this;},
      maybeSingle:async()=>({error:schemaMissing&&columns==='export_verification'?{code:'42703'}:null,data:table==='user_registrations'?{id}:table==='cargomove_scheduler_runs'?{dispatch_at:dispatchMissing?null:new Date(dispatchAt).toISOString()}:recovery}),then:(resolve:any)=>Promise.resolve({error:null}).then(resolve)};return query;
  }};
  const handler=createNorthportHandler({adminClient:()=>client,readSession:()=>({id,email:'admin@example.test',type:'ADMIN'}),verifyExportContainer:async(input:any)=>{lookups++;assert.deepEqual(input,expected);return evidence;},verifyGatepass:async()=>assert.fail('No GP lookup'),runScheduler:async()=>assert.fail('No scheduler execution'),withFtp:async()=>assert.fail('No FTP')} as any);
  const call=async()=>{const response:any={code:200,setHeader(){},status(code:number){this.code=code;return this;},json(body:any){this.body=body;return this;}};await handler({method:'POST',headers:{origin:'https://portal.example.test','x-cargomove-confirm':'northport-recovery'},body:{action:'verify-result',id,container:'UNTRUSTED',scn:'UNTRUSTED'}},response);return response;};
  assert.equal((await call()).body.status,'Import Verified');
  assert.equal(updates[0].export_verification.status,'VERIFIED');assert.equal(updates[0].status,'Import Verified');
  for(const status of ['NOT_FOUND','STALE','UNAVAILABLE'] as const){
    evidence={...evidence,status};
    assert.equal((await call()).body.status,status==='UNAVAILABLE'?'Pending Verification':'Verification Failed');
    assert.equal(updates.at(-1).status,undefined);assert.equal(guards.at(-1),'Import Verified');
  }
  schemaMissing=true;assert.equal((await call()).code,503);schemaMissing=false;
  dispatchMissing=true;assert.equal((await call()).code,503);dispatchMissing=false;
  recovery={...recovery,approved_values:null};assert.equal((await call()).code,409);
  recovery={...recovery,approved_values:values,status:'Approved'};assert.equal((await call()).code,409);
  assert.equal(lookups,4);
});

test('scheduler observations alone never make exports successful; imports retain their exact GP rule',()=>{
  const base:any={container_type:'EX',status:'Scheduler Triggered',scheduler_status:'trigger_requested',processing_result:'Scheduler run observed — container import not verified',scheduler_run:{last_run_verification:{status:'ADVANCED'}}};
  assert.equal(recoveryFlow(base).label,'PROCESSING');
  for(const [status,label] of [['VERIFIED','SUCCESS'],['STALE','FAIL'],['NOT_FOUND','FAIL'],['UNAVAILABLE','PROCESSING']] as const)assert.equal(recoveryFlow({...base,export_verification:{status}}).label,label);
  assert.equal(recoveryFlow({...base,container_type:'GP',gp_verification:{status:'VERIFIED'}}).label,'SUCCESS');
  assert.equal(recoveryFlow({...base,container_type:'GP',export_verification:{status:'VERIFIED'}}).label,'PROCESSING');
  assert.equal(recoveryFlow({...base,export_verification:{status:'VERIFIED'},manual_review:{outcome:'FAIL'}}).label,'FAIL');
});
