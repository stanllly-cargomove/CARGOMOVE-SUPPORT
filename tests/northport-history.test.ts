import test from 'node:test';
import assert from 'node:assert/strict';
import { createNorthportHandler } from '../server-handlers/northport/handler.js';

test('history tolerates the missing scheduler evidence column and reports precise schema failures',async()=>{
  for(const scenario of ['ready','missing-scheduler','missing-manual','missing-search','missing-optional','missing-gp','network'] as const) {
    const columns:string[]=[];
    const client:any={from:(table:string)=>{
      let selected='';
      const query:any={select(value:string){selected=value;return this;},eq(){return this;},order(){return this;},limit(){return this;},timeout(){return this;},
        maybeSingle:async()=>({data:{id:'profile'},error:null}),
        then(resolve:any){
          assert.equal(table,'northport_recoveries');columns.push(selected);
          const error=scenario==='network'?{message:'fetch failed'}
            :(scenario==='missing-manual'||scenario==='missing-optional')&&selected.includes('manual_review')?{code:'42703',message:'column northport_recoveries.manual_review does not exist'}
            :(scenario==='missing-search'||scenario==='missing-optional')&&selected.includes('search_setup')?{code:'42703',message:'column northport_recoveries.search_setup does not exist'}
            :scenario==='missing-gp'?{code:'42703',message:'column northport_recoveries.gp_verification does not exist'}
            :(scenario==='missing-scheduler'||scenario==='missing-optional')&&selected.includes('scheduler_run:')?{code:'42703',message:'column cargomove_scheduler_runs_1.last_run_verification does not exist'}:null;
          return Promise.resolve({data:error?null:[{id:'existing-recovery',status:'Uploaded'}],error}).then(resolve);
        }};
      return query;
    }};
    const handler=createNorthportHandler({adminClient:()=>client,readSession:()=>({id:'admin',email:'admin@example.test',type:'ADMIN'})} as any);
    const response:any={code:200,setHeader(){},status(code:number){this.code=code;return this;},json(body:any){this.body=body;return this;}};
    await handler({method:'GET',headers:{}},response);
    if(!['missing-gp','network'].includes(scenario)) {
      assert.equal(response.code,200);assert.equal(response.body.history[0].id,'existing-recovery');
      assert.equal(columns.length,scenario==='ready'?1:scenario==='missing-optional'?4:2);
      if(scenario==='missing-scheduler') {
        assert.match(response.body.historyWarning,/20261021000000_scheduler_verification_30_seconds.sql/);
        assert.ok(!columns[1].includes('scheduler_run:'));
      } else if(scenario==='missing-manual') {assert.equal(response.body.manualReviewEnabled,false);assert.match(response.body.historyWarning,/20261021030000_northport_manual_reviews.sql/);}
      else if(scenario==='missing-search'){assert.equal(response.body.manualReviewEnabled,true);assert.match(response.body.historyWarning,/20261021040000_northport_retry_search_setup.sql/);}
      else if(scenario==='missing-optional'){assert.equal(response.body.manualReviewEnabled,false);assert.match(response.body.historyWarning,/20261021040000_northport_retry_search_setup.sql/);assert.ok(!columns[3].includes('manual_review')&&!columns[3].includes('search_setup')&&!columns[3].includes('scheduler_run:'));}
      else {assert.equal(response.body.historyWarning,undefined);assert.equal(response.body.manualReviewEnabled,true);}
    } else {
      assert.equal(response.code,503);assert.equal(columns.length,1,'Do not retry unrelated failures');
      assert.match(response.body.error,scenario==='missing-gp'?/20261021010000_northport_gp_verification.sql/:/database connection/);
    }
  }
});

test('manual review API validates notes, records the authenticated actor and rejects stale or unuploaded decisions without external work',async()=>{
  process.env.SCHEDULER_PORTAL_URL='https://portal.example.test';
  const id='10000000-0000-4000-8000-000000000001';
  let row:any={id,status:'Uploaded',container_type:'GP'};
  let conflict=false;const reviews:any[]=[];
  const client:any={
    from:(table:string)=>{let columns='';const query:any={select(value:string){columns=value;return this;},eq(){return this;},timeout(){return this;},maybeSingle:async()=>({data:table==='user_registrations'?{id:'profile'}:row,error:null})};return query;},
    rpc:async(name:string,args:any)=>{
      if(name==='northport_admit_request')return {data:true};
      assert.equal(name,'northport_review_recovery');reviews.push(args);
      return {data:conflict?{reason:'changed'}:{id:'review',outcome:args.p_outcome,note:args.p_note,reviewedBy:'admin@example.test',reviewedAt:new Date().toISOString()}};
    },
  };
  const handler=createNorthportHandler({adminClient:()=>client,readSession:()=>({id:'authenticated-admin',email:'admin@example.test',type:'ADMIN'}),withFtp:async()=>{assert.fail('Manual review cannot use FTP');},runScheduler:async()=>{assert.fail('Manual review cannot run the scheduler');}} as any);
  const call=async(changes:any={})=>{const response:any={code:200,setHeader(){},status(code:number){this.code=code;return this;},json(body:any){this.body=body;return this;}};await handler({method:'POST',headers:{origin:'https://portal.example.test','x-cargomove-confirm':'northport-recovery'},body:{action:'manual-review',id,outcome:'SUCCESS',note:'Checked exact pair in CargoMove.',actor:'untrusted',...changes}},response);return response;};
  assert.equal((await call({note:'x'})).code,400);
  assert.equal((await call({outcome:'CANCELLED'})).code,400);
  assert.equal(reviews.length,0);
  assert.equal((await call()).body.status,'SUCCESS');
  assert.equal(reviews[0].p_actor,'authenticated-admin');
  assert.equal(reviews[0].p_expected_review_id,null);
  conflict=true;assert.equal((await call()).code,409);
  row={...row,status:'Approved'};assert.equal((await call()).code,409);
  assert.equal(reviews.length,2);
});
