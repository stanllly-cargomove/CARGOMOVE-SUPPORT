import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { signSession } from '../api/_runtime.js';
import { recordAcceptedReply } from '../server-handlers/auto-mail/delivery-receipt.js';
import { learningList, learningDetail, learningPropose, learningReview } from '../server-handlers/auto-mail/learning.js';

const actor='10000000-0000-4000-8000-000000000001';
const mailbox='10000000-0000-4000-8000-000000000002';
const connectionVersion='10000000-0000-4000-8000-000000000003';
const draftId='10000000-0000-4000-8000-000000000004';
const deliveryId='10000000-0000-4000-8000-000000000005';
const manualId='10000000-0000-4000-8000-000000000006';
const article={title:'General registration procedure',content:'Provide an authorization letter and company certificate.',summary:'Reusable procedure.',category:'Registration',port:'ALL',keywords:['authorization','registration']};

test('learning captures confirmed corrections once, preserves evidence and requires versioned review before changing KB',async()=>{
  const db=new PGlite();
  try{
    await db.exec("create role anon;create role authenticated;create role service_role bypassrls;create table public.untouched(value text);insert into public.untouched values('original');");
    for(const file of ['20261022000000_foundation.sql','20261022010000_gmail_manual_replies.sql','20261022020000_knowledge_base.sql','20261022030000_ai_reply_drafts.sql','20261022040000_reviewed_learning.sql'])await db.exec(readFileSync(new URL('../supabase/auto-mail/migrations/'+file,import.meta.url),'utf8'));
    const scalar=async(sql:string,params:unknown[]=[])=>Object.values((await db.query<any>(sql,params)).rows[0])[0] as any;
    await db.query("insert into auto_mail.mailboxes(id,email) values($1,'operator@example.com')",[mailbox]);
    await db.query("insert into auto_mail.gmail_connections(id,mailbox_id,google_subject,email,refresh_token_ciphertext,token_iv,token_auth_tag,scopes,connected_by,version) values('system',$1,'google','operator@example.com','cipher','iv','tag','{}',$2,$3)",[mailbox,actor,connectionVersion]);
    const base=await scalar('select auto_mail.save_knowledge_article(null,null,$1,$2)',[JSON.stringify(article),actor]);
    await scalar("select auto_mail.review_knowledge_article($1,1,'APPROVE',$2)",[base.id,actor]);
    const sources=[{id:base.id,version:2,title:article.title,port:'ALL',content:article.content}];
    await db.query("insert into auto_mail.ai_reply_drafts(id,mailbox_id,connection_version,gmail_thread_id,source_message_id,conversation_hash,scope,provider,model,requested_by,status,sources,body_text) values($1,$2,$3,'thread1','incoming1','hash','ALL','openai','test-model',$4,'READY',$5,'Original AI reply.')",[draftId,mailbox,connectionVersion,actor,JSON.stringify(sources)]);
    const claim={id:deliveryId,mailbox_id:mailbox,connection_version:connectionVersion,gmail_thread_id:'thread1',source_message_id:'incoming1',conversation_hash:'hash',recipient:'customer@example.com',body_text:'Corrected staff answer with case-specific reference REF123.',requested_by:actor,ai_draft_id:draftId,subject:'Re: Registration documents',customer_question:'Customer question about REF123'};
    await db.exec('set role service_role');
    await scalar('select auto_mail.claim_manual_reply($1)',[JSON.stringify(claim)]);
    await assert.rejects(()=>scalar('select auto_mail.propose_learning_from_reply($1,$2)',[deliveryId,actor]),/LEARNING_NOT_SENT/);
    await assert.rejects(()=>scalar("select auto_mail.finish_manual_reply($1,$2,'gmail-sent')",[deliveryId,manualId]),/LEARNING_INVALID_DELIVERY/);
    const finished=await scalar("select auto_mail.finish_manual_reply($1,$2,'gmail-sent')",[deliveryId,actor]);
    assert.equal(finished.learning_queued,true);
    const suggested=await scalar('select auto_mail.propose_learning_from_reply($1,$2)',[deliveryId,actor]);
    assert.equal(suggested.status,'PENDING');assert.equal(suggested.reason,'AI_CORRECTION');
    assert.equal(suggested.evidence.ai_original,'Original AI reply.');
    assert.equal(suggested.evidence.sent_reply,claim.body_text);assert.equal(suggested.evidence.question,claim.customer_question);
    assert.equal(suggested.proposed_title,'Registration documents');
    assert.equal((await scalar("select auto_mail.finish_manual_reply($1,$2,'gmail-sent')",[deliveryId,actor])).suggestion_id,suggested.id);
    assert.equal(await scalar('select count(*)::int from auto_mail.learning_suggestions'),1,'Confirmed receipt retries cannot duplicate suggestions');
    assert.equal(await scalar('select count(*)::int from auto_mail.knowledge_articles'),1,'Pending learning never changes the KB');
    assert.deepEqual(await scalar("select auto_mail.match_knowledge_articles('REF123')"),[]);
    const list=await scalar("select auto_mail.list_learning_suggestions('PENDING',0)");
    assert.equal(list.total,1);assert.equal(list.suggestions[0].evidence,undefined);
    const approve=(s:any,target:string|null=null,expected:number|null=null)=>scalar("select auto_mail.review_learning_suggestion($1,$2,'APPROVE',$3,$4,$5,'Removed case-specific data',$6)",[s.id,s.version,JSON.stringify(article),target,expected,actor]);
    const approved=await approve(suggested);
    assert.equal(approved.status,'APPROVED');assert.equal(approved.reviewed_article.status,'APPROVED');
    assert.equal(approved.reviewed_article.content,article.content);assert.equal(approved.published_article_version,2);
    await assert.rejects(()=>approve(suggested),/LEARNING_CONFLICT/);
    assert.equal(await scalar('select count(*)::int from auto_mail.knowledge_articles'),2);
    const manual={...claim,id:manualId,ai_draft_id:null,gmail_thread_id:'thread2',source_message_id:'incoming2',body_text:'A manual support reply.'};
    await scalar('select auto_mail.claim_manual_reply($1)',[JSON.stringify(manual)]);
    const manualFinished=await scalar("select auto_mail.finish_manual_reply($1,$2,'gmail-manual')",[manualId,actor]);
    assert.equal(manualFinished.learning_queued,false,'Unnominated manual replies do not populate the queue');
    const manualSuggestion=await scalar('select auto_mail.propose_learning_from_reply($1,$2)',[manualId,actor]);
    assert.equal(manualSuggestion.reason,'MANUAL_REPLY');
    await assert.rejects(()=>scalar("select auto_mail.review_learning_suggestion($1,1,'REJECT',null,null,null,'',$2)",[manualSuggestion.id,actor]),/REJECTION_NOTE_REQUIRED/);
    await scalar("select auto_mail.review_learning_suggestion($1,1,'REJECT',null,null,null,'One-off case; not reusable',$2)",[manualSuggestion.id,actor]);
    assert.equal(await scalar('select count(*)::int from auto_mail.knowledge_articles'),2,'Rejection never changes the KB');
    const thirdId='10000000-0000-4000-8000-000000000007';
    await scalar('select auto_mail.claim_manual_reply($1)',[JSON.stringify({...manual,id:thirdId,source_message_id:'incoming3'})]);
    await scalar("select auto_mail.finish_manual_reply($1,$2,'gmail-third')",[thirdId,actor]);
    const third=await scalar('select auto_mail.propose_learning_from_reply($1,$2)',[thirdId,actor]);
    await assert.rejects(()=>approve(third,base.id,1),/KB_CONFLICT/);
    assert.equal(await scalar('select status from auto_mail.learning_suggestions where id=$1',[third.id]),'PENDING');
    const updated=await approve(third,base.id,2);
    assert.equal(updated.published_article_id,base.id);assert.equal(updated.published_article_version,4);
    await assert.rejects(()=>db.exec("update auto_mail.learning_suggestions set proposed_content='tampered'"),/permission denied/);
    await assert.rejects(()=>db.exec('delete from auto_mail.learning_events'),/permission denied/);
    await db.exec('reset role');
    assert.equal(await scalar("select has_function_privilege('authenticated','auto_mail.review_learning_suggestion(uuid,integer,text,jsonb,uuid,integer,text,uuid)','EXECUTE')"),false);
    assert.equal(await scalar('select value from public.untouched'),'original');
    assert.equal(await scalar('select schema_version from auto_mail.settings'),5);assert.equal(await scalar('select reply_mode from auto_mail.settings'),'DRAFT_ONLY');
    const actions=(await db.query<any>('select action from auto_mail.learning_events where suggestion_id=$1 order by created_at',[suggested.id])).rows.map(row=>row.action);
    assert.deepEqual(actions,['CREATED','APPROVED']);
  }finally{await db.close();}
});

test('known successful Gmail sends keep SENT semantics when learning or receipt storage fails',async()=>{
  let fallback=0;
  const client={rpc:async()=>({data:{learning_queued:true},error:null}),from:()=>{fallback++;return{update:()=>({eq:async()=>({error:null})})};}};
  assert.deepEqual(await recordAcceptedReply(client,'id','actor','gmail'),{saved:true,learningQueued:true});
  client.rpc=async()=>({data:null,error:{code:'PGRST202'}} as any);
  assert.deepEqual(await recordAcceptedReply(client,'id','actor','gmail'),{saved:true,learningQueued:false});assert.equal(fallback,1);
  client.rpc=async()=>({data:null,error:{code:'XX000'}} as any);
  assert.deepEqual(await recordAcceptedReply(client,'id','actor','gmail'),{saved:false,learningQueued:false});assert.equal(fallback,1,'Uncertain DB failures are not retried');
  client.rpc=async()=>{throw new Error('network');};
  assert.deepEqual(await recordAcceptedReply(client,'id','actor','gmail'),{saved:false,learningQueued:false});
});

test('learning routes require ADMIN and same origin; reviews use the session actor and preserve conflicts',async()=>{
  const overrides={AUTO_MAIL_ENABLED:'true',AUTO_MAIL_SUPABASE_URL:'https://learning-dev.supabase.co',AUTO_MAIL_SUPABASE_SERVICE_ROLE_KEY:'test-key',SUPABASE_URL:'https://primary.supabase.co',VITE_SUPABASE_URL:'https://primary.supabase.co',VERCEL_ENV:'development',AUTO_MAIL_APP_URL:'http://localhost:3000',SESSION_SECRET:'test-learning-session'};
  const before=Object.fromEntries(Object.keys(overrides).map(key=>[key,process.env[key]]));Object.assign(process.env,overrides);
  const original=globalThis.fetch;let calls=0;let conflict=false;
  globalThis.fetch=(async(input:any,init:any)=>{
    calls++;const url=new URL(String(input));assert.equal(url.hostname,'learning-dev.supabase.co','No Gmail, OpenAI, or main DB call is allowed');
    const payload=JSON.parse(init.body);
    assert.equal(payload.p_actor,actor);
    if(url.pathname.endsWith('/propose_learning_from_reply'))return new Response(JSON.stringify({id:deliveryId,status:'PENDING'}),{status:200});
    assert.ok(url.pathname.endsWith('/review_learning_suggestion'));assert.equal(payload.p_article.created_by,undefined);
    return new Response(JSON.stringify(conflict?{message:'KB_CONFLICT'}:{status:'APPROVED'}),{status:conflict?400:200});
  }) as typeof fetch;
  const cookie='cargomove_session='+signSession({id:actor,email:'admin@example.com',type:'ADMIN',exp:Date.now()+60000});
  const invoke=async(handler:any,body:any={},headers:any={cookie,origin:'http://localhost:3000'})=>{const res={code:200,value:null as any,setHeader(){},status(code:number){this.code=code;return this;},json(value:any){this.value=value;}};await handler({method:'POST',headers,body},res);return res;};
  try{
    for(const handler of [learningList,learningDetail,learningPropose,learningReview])assert.equal((await invoke(handler,{},{})).code,401);
    assert.equal((await invoke(learningPropose,{deliveryId},{cookie,origin:'https://evil.example'})).code,403);assert.equal(calls,0);
    assert.equal((await invoke(learningPropose,{deliveryId})).value.suggestion.status,'PENDING');
    assert.equal((await invoke(learningReview,{...article,id:deliveryId,version:1,action:'APPROVE',created_by:'attacker'})).value.suggestion.status,'APPROVED');
    conflict=true;const result=await invoke(learningReview,{...article,id:deliveryId,version:1,action:'APPROVE',targetId:actor,targetVersion:1});
    assert.equal(result.code,409);assert.match(result.value.error,/unsaved text is preserved/);
  }finally{globalThis.fetch=original;for(const key of Object.keys(overrides)){if(before[key]===undefined)delete process.env[key];else process.env[key]=before[key];}}
});
