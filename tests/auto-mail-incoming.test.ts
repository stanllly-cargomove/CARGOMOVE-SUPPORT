import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { classificationRequest,incomingDecision,validateClassification,runIncomingAi,incomingSettings } from '../server-handlers/auto-mail/incoming-ai.js';
import {encryptRefreshToken} from '../server-handlers/_email.js';
import {presentThread} from '../server-handlers/auto-mail/gmail.js';
import {threadSignature} from '../server-handlers/auto-mail/thread-signature.js';
const actor='10000000-0000-4000-8000-000000000001',other='10000000-0000-4000-8000-000000000002',mailbox='10000000-0000-4000-8000-000000000003',version='10000000-0000-4000-8000-000000000004',lease='10000000-0000-4000-8000-000000000005';
test('classification requires grounded source IDs and sends weak/new/uncertain mail to review, skips only confident marketing/spam',()=>{
 const sources=[{id:actor,title:'Registration',version:1,port:'ALL',content:'Supply the company certificate.'}];
 const classified={category:'SUPPORT_REQUEST',confidence:0.95,language:'en',kb_match:'STRONG',source_ids:[actor],reason:'Directly supported.'};
 assert.equal(incomingDecision(validateClassification(classified,sources)),'KB');
 assert.throws(()=>validateClassification({...classified,source_ids:[other]},sources));
 assert.throws(()=>validateClassification({...classified,source_ids:[]},sources));
 assert.throws(()=>validateClassification({...classified,confidence:2},sources));
 assert.equal(incomingDecision(validateClassification({...classified,kb_match:'WEAK'},sources)),'ACKNOWLEDGEMENT');
 assert.equal(incomingDecision(validateClassification({...classified,category:'NEW_TECHNICAL_ISSUE'},sources)),'ACKNOWLEDGEMENT');
 assert.equal(incomingDecision(validateClassification({...classified,category:'SPAM',confidence:0.89},sources)),'ACKNOWLEDGEMENT');
 assert.equal(incomingDecision(validateClassification({...classified,category:'MARKETING'},sources)),'SKIP');
 const request=classificationRequest('configured-model','ALL',{id:'thread',subject:'Untrusted request',messages:[]} as any,sources);
 assert.equal(request.model,'configured-model');assert.equal(request.store,false);assert.equal('tools' in request,false);assert.equal(request.text.format.strict,true);assert.match(request.instructions,/keyword overlap alone is insufficient/);
});
test('incoming migration enforces leases, uniqueness, grounded or fixed acknowledgements, cross-admin adoption, corrections review and explicit enablement',async()=>{
 const db=new PGlite();try{
  await db.exec('create role anon;create role authenticated;create role service_role bypassrls;');
  for(const file of ['20261022000000_foundation.sql','20261022010000_gmail_manual_replies.sql','20261022020000_knowledge_base.sql','20261022030000_ai_reply_drafts.sql','20261022040000_reviewed_learning.sql','20261022050000_agent_settings.sql','20261023010000_incoming_ai_workflow.sql'])await db.exec(readFileSync(new URL('../supabase/auto-mail/migrations/'+file,import.meta.url),'utf8'));
  const scalar=async(sql:string,params:unknown[]=[])=>Object.values((await db.query<any>(sql,params)).rows[0])[0] as any;
  await db.query("insert into auto_mail.mailboxes(id,email) values($1,'support@example.com')",[mailbox]);
  await db.query("insert into auto_mail.gmail_connections(id,mailbox_id,google_subject,email,refresh_token_ciphertext,token_iv,token_auth_tag,scopes,connected_by,version) values('system',$1,'subject','support@example.com','cipher','iv','tag','{}',$2,$3)",[mailbox,actor,version]);
  await scalar('select auto_mail.save_agent_settings(true,\'test-model\',array[\'test-model\'],0,$1)',[actor]);
  assert.equal(await scalar('select auto_mail.begin_incoming_tick($1)',[lease]),null);
  await scalar("select auto_mail.save_incoming_settings(true,'ALL',1,$1)",[actor]);
  const started=await scalar('select auto_mail.begin_incoming_tick($1)',[lease]);assert.equal(started.connection_version,version);
  assert.equal(await scalar('select auto_mail.begin_incoming_tick($1)',[other]),null,'Overlapping cron ticks cannot run');
  const claim=(source:string)=>scalar('select auto_mail.claim_incoming_message($1,$2)',[lease,JSON.stringify({source_message_id:source,gmail_thread_id:'thread-'+source,conversation_hash:'hash-'+source,subject:'Unknown issue'})]);
  const ack=await claim('inbound1');assert.equal(await claim('inbound1'),null,'Repeated discovery cannot regenerate a message');
  const text=await scalar("select auto_mail.acknowledgement_body('en')");
  const result={status:'DRAFT_READY',classification:{category:'NEW_TECHNICAL_ISSUE',kb_match:'NONE'},model:'test-model',draft_kind:'ACKNOWLEDGEMENT',sources:[],cited_source_ids:[],body_text:text,review_notes:'Support review needed.'};
  const finish=(job:any,value:any)=>scalar('select auto_mail.finish_incoming_message($1,$2,$3)',[lease,job.id,JSON.stringify(value)]);
  await assert.rejects(()=>finish(ack,{...result,body_text:'We have fixed your issue.'}),/AI_INVALID_ACKNOWLEDGEMENT/);
  assert.equal(await finish(ack,result),ack.id);
  const valid=await scalar('select auto_mail.validate_ai_draft($1,$2)',[ack.id,actor]);assert.equal(valid.status,'NEEDS_REVIEW');assert.deepEqual(valid.sources,[]);
  await assert.rejects(()=>scalar('select auto_mail.validate_ai_draft($1,$2)',[ack.id,other]),/AI_DRAFT_UNAVAILABLE/);
  const adopted=await scalar('select auto_mail.adopt_incoming_draft($1,$2)',[ack.id,other]);assert.notEqual(adopted,ack.id);assert.equal(await scalar('select auto_mail.adopt_incoming_draft($1,$2)',[ack.id,other]),adopted);
  const personal=await scalar('select auto_mail.validate_ai_draft($1,$2)',[adopted,other]);assert.equal(personal.body_text,text);
  const delivery={id:crypto.randomUUID(),mailbox_id:mailbox,connection_version:version,gmail_thread_id:'thread-inbound1',source_message_id:'inbound1',conversation_hash:'hash-inbound1',recipient:'customer@example.com',body_text:'We verified the issue. Follow the reviewed recovery procedure.',requested_by:other,ai_draft_id:adopted,customer_question:'New technical problem',subject:'New issue'};
  await scalar('select auto_mail.claim_manual_reply($1)',[JSON.stringify(delivery)]);
  const confirmed=await scalar("select auto_mail.finish_manual_reply($1,$2,'gmail-sent')",[delivery.id,other]);assert.equal(confirmed.learning_queued,true);
  const evidence=await scalar('select evidence from auto_mail.learning_suggestions where source_delivery_id=$1',[delivery.id]);assert.equal(evidence.ai_original,text);assert.equal(evidence.sent_reply,delivery.body_text);
  assert.equal(await scalar('select count(*)::int from auto_mail.knowledge_articles'),0,'A correction does not publish itself');
  let article=await scalar('select auto_mail.save_knowledge_article(null,null,$1,$2)',[JSON.stringify({title:'Verified recovery',summary:'Recovery',content:'Use the approved reset procedure.',category:'Support',port:'ALL',keywords:['reset']}),actor]);
  article=await scalar("select auto_mail.review_knowledge_article($1,1,'APPROVE',$2)",[article.id,actor]);
  const kb=await claim('inbound2');const kbResult={...result,draft_kind:'KB',sources:[{id:article.id,version:article.version,title:article.title,port:'ALL',content:article.content}],cited_source_ids:[article.id],body_text:'Use the approved reset procedure.'};
  await finish(kb,kbResult);await scalar('select auto_mail.validate_ai_draft($1,$2)',[kb.id,actor]);
  await scalar('select auto_mail.save_knowledge_article($1,$2,$3,$4)',[article.id,article.version,JSON.stringify({title:article.title,summary:'Updated',content:'Changed procedure.',category:'Support',port:'ALL',keywords:['reset']}),actor]);
  await assert.rejects(()=>scalar('select auto_mail.validate_ai_draft($1,$2)',[kb.id,actor]),/AI_SOURCES_CHANGED/);
  const pending=await claim('inbound3');await scalar("select auto_mail.save_incoming_settings(false,'ALL',2,$1)",[actor]);
  await assert.rejects(()=>finish(pending,result),/CONNECTION_CHANGED/,'Turning off drafting prevents an in-flight publish');
  assert.equal(await scalar("select has_function_privilege('authenticated','auto_mail.begin_incoming_tick(uuid)','EXECUTE')"),false);
  assert.equal(await scalar("select has_table_privilege('authenticated','auto_mail.incoming_ai_jobs','SELECT')"),false);
  await scalar("select auto_mail.save_incoming_settings(true,'ALL',3,$1)",[actor]);
  await db.query("insert into auto_mail.incoming_ai_jobs(mailbox_id,connection_version,source_message_id,gmail_thread_id,conversation_hash,subject,actor_id,settings_version,worker_token,status) select $1,$2,'rate-'||n,'thread-'||n,'hash','subject',$3,4,$4,'FAILED' from generate_series(1,17) n",[mailbox,version,actor,lease]);
  await db.exec("update auto_mail.incoming_worker_state set lease_until=now()-interval '1 second',cursor='preserved';update auto_mail.incoming_ai_jobs set created_at=now()-interval '4 minutes' where status='PROCESSING'");
  assert.equal(await scalar('select auto_mail.begin_incoming_tick($1)',[other]),null,'Hourly admission limit stops new provider work');
  assert.equal(await scalar('select status from auto_mail.incoming_ai_jobs where id=$1',[pending.id]),'FAILED','Expired work is quarantined without regenerating it');
  assert.equal(await scalar("select cursor from auto_mail.incoming_worker_state where id='system'"),'preserved','Rate limiting does not advance the mailbox cursor');
  await db.exec('set role service_role');await assert.rejects(()=>db.exec("update auto_mail.incoming_ai_jobs set status='SKIPPED'"),/permission denied/);
 }finally{await db.close();}
});
test('worker and settings reject unauthenticated calls before accessing providers or storage',async()=>{
 const realFetch=globalThis.fetch;globalThis.fetch=(async()=>{throw new Error('Unexpected network');}) as typeof fetch;
 try{for(const handler of [runIncomingAi,incomingSettings]){let status=200;const response={setHeader(){},status(value:number){status=value;return this;},json(){}};await handler({method:'POST',headers:{},body:{}},response);assert.equal(status,401);}}finally{globalThis.fetch=realFetch;}
});

test('scheduled worker classifies real thread snapshots, drafts known/unknown requests, skips marketing, preserves cursor and blocks changed threads without sending',async()=>{
 const env={AUTO_MAIL_APP_URL:'http://localhost:3000',AUTO_MAIL_ENABLED:'true',AUTO_MAIL_SUPABASE_URL:'https://separate.supabase.co',AUTO_MAIL_SUPABASE_SERVICE_ROLE_KEY:'fake-key',SUPABASE_URL:'https://primary.supabase.co',AUTO_MAIL_AI_ENABLED:'true',OPENAI_API_KEY:'fake-openai-key',AUTO_MAIL_AI_MODEL:'test-model',GOOGLE_TOKEN_ENCRYPTION_KEY:Buffer.alloc(32,4).toString('base64'),GOOGLE_OAUTH_CLIENT_ID:'fake-client',GOOGLE_OAUTH_CLIENT_SECRET:'fake-secret',AUTO_MAIL_SCHEDULER_SECRET:'x'.repeat(40)};
 const before=Object.fromEntries(Object.keys(env).map(key=>[key,process.env[key]]));Object.assign(process.env,env);const originalFetch=globalThis.fetch;
 try{for(const mode of ['known','unknown','marketing','uncertain','changed','disabled'] as const){
  let calls=0,finished:any=null,cursor:any=null,reads=0;const paths:string[]=[];
  const raw={id:'thread',messages:[{id:'incoming',internalDate:String(Date.now()-1000),labelIds:['INBOX'],payload:{mimeType:'text/plain',headers:[{name:'From',value:'Customer <customer@example.com>'},{name:'To',value:'support@example.com'},{name:'Subject',value:'Registration help'},{name:'Message-ID',value:'<source@example.com>'}],body:{data:Buffer.from('Please help with registration.').toString('base64url')}}}]};
  const source={id:other,title:'Registration',version:2,content:'Supply the certificate.',port:'ALL'};
  globalThis.fetch=(async(input:any,init:any={})=>{
   const url=new URL(String(input));paths.push(url.pathname);assert.ok(!url.hostname.includes('primary'));assert.ok(!url.pathname.includes('/messages/send'));assert.ok(!url.pathname.includes('/modify'));const json=(value:any)=>new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json'}});const body=typeof init.body==='string'&&init.body.startsWith('{')?JSON.parse(init.body):{};
   if(url.pathname.endsWith('/agent_settings'))return json({enabled:mode!=='disabled',model:'test-model',enabled_models:['test-model'],version:1});
   if(url.pathname.endsWith('/begin_incoming_tick'))return json({enabled_at:new Date(Date.now()-60000).toISOString(),scope:'ALL',cursor:null,connection_version:version});
   if(url.pathname.endsWith('/gmail_connections'))return json({id:'system',mailbox_id:mailbox,version,email:'support@example.com',...encryptRefreshToken('fake-refresh')});
   if(url.hostname==='oauth2.googleapis.com')return json({access_token:'fake-token'});
   if(url.pathname.endsWith('/gmail/v1/users/me/messages'))return json({messages:[{id:'incoming',threadId:'thread'}]});
   if(url.pathname.endsWith('/gmail/v1/users/me/threads/thread')){reads++;const value=structuredClone(raw);if(mode==='changed'&&reads>1)value.messages[0].payload.body.data=Buffer.from('A changed question.').toString('base64url');return json(value);}
   if(url.pathname.endsWith('/incoming_ai_jobs'))return json([]);
   if(url.pathname.endsWith('/claim_incoming_message'))return json({id:lease,conversation_hash:threadSignature(presentThread(raw,'support@example.com'))});
   if(url.pathname.endsWith('/match_knowledge_articles'))return json(mode==='known'||mode==='changed'?[source]:[]);
   if(url.pathname.endsWith('/acknowledgement_body'))return json('Thank you. Please share the error and relevant reference details.');
   if(url.hostname==='api.openai.com'){
    calls++;assert.equal(body.model,'test-model');assert.equal(body.store,false);assert.equal(body.tools,undefined);
    const value=body.text.format.name==='incoming_mail_classification'?{category:mode==='marketing'?'MARKETING':mode==='unknown'?'NEW_TECHNICAL_ISSUE':mode==='uncertain'?'UNCERTAIN':'SUPPORT_REQUEST',confidence:mode==='uncertain'?0.5:0.95,language:'en',kb_match:mode==='known'||mode==='changed'?'STRONG':'NONE',source_ids:mode==='known'||mode==='changed'?[source.id]:[],reason:'Fixture classification'}:{status:'READY',body_text:'Supply the certificate.',review_notes:'Check the requirement.',cited_source_ids:[source.id]};
    return json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(value)}]}]});
   }
   if(url.pathname.endsWith('/finish_incoming_message')){finished=body.p_result;return json(lease);}
   if(url.pathname.endsWith('/end_incoming_tick')){cursor=JSON.parse(body.p_cursor);return json(null);}
   throw new Error('Unexpected worker request '+url.pathname);
  }) as typeof fetch;
  let code=200,value:any;const response={setHeader(){},status(status:number){code=status;return this;},json(result:any){value=result;}};
  await runIncomingAi({method:'POST',headers:{authorization:'Bearer '+env.AUTO_MAIL_SCHEDULER_SECRET}},response);
  if(mode==='disabled'){assert.equal(calls,0);assert.equal(value.disabled,true);continue;}
  if(mode==='changed'){assert.equal(code,503);assert.equal(finished.status,'FAILED');continue;}
  assert.equal(code,200,JSON.stringify({mode,finished,paths}));assert.equal(value.processed,1);assert.ok(cursor.after>0);
  if(mode==='marketing'){assert.equal(finished.status,'SKIPPED');assert.equal(calls,1);}
  else if(mode==='known'){assert.equal(finished.status,'DRAFT_READY');assert.equal(finished.draft_kind,'KB');assert.deepEqual(finished.cited_source_ids,[source.id]);assert.equal(calls,2);}
  else{assert.equal(finished.status,'DRAFT_READY');assert.equal(finished.draft_kind,'ACKNOWLEDGEMENT');assert.deepEqual(finished.sources,[]);assert.equal(calls,1);}
 }}finally{globalThis.fetch=originalFetch;for(const key of Object.keys(env)){if(before[key]===undefined)delete process.env[key];else process.env[key]=before[key];}}
});
