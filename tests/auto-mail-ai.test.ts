import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { aiConfiguration, aiGenerate, aiScope, aiUse, buildAiRequest, generateOpenAiDraft, validateAiOutput } from '../server-handlers/auto-mail/ai.js';
import { recommendMailScope } from '../server-handlers/auto-mail/scope.js';
import { encryptRefreshToken } from '../server-handlers/_email.js';
import { signSession } from '../api/_runtime.js';
import { presentThread } from '../server-handlers/auto-mail/gmail.js';
import { threadSignature } from '../server-handlers/auto-mail/thread-signature.js';

const actor = '10000000-0000-4000-8000-000000000001';
const mailbox = '10000000-0000-4000-8000-000000000002';
const version = '10000000-0000-4000-8000-000000000003';
const requestId = '10000000-0000-4000-8000-000000000004';
const sourceId = '10000000-0000-4000-8000-000000000005';
const sources = [{ id: sourceId, version: 2, title: 'Registration documents', content: 'Provide the company certificate.', port: 'ALL' }];
const output = { status: 'READY', body_text: 'Please provide the company certificate.', review_notes: 'Review before sending.', cited_source_ids: [sourceId] };
const rawThread = () => ({ id: 'thread1', messages: [{ id: 'incoming1', internalDate: '1720000000000', labelIds: ['INBOX'], payload: { mimeType: 'text/plain', headers: [
  { name: 'From', value: 'customer@example.com' }, { name: 'To', value: 'operator@example.com' }, { name: 'Subject', value: 'Registration documents' }, { name: 'Message-ID', value: '<customer@example.com>' },
], body: { data: Buffer.from('What registration documents do I need?').toString('base64url') } } }] });

test('automatic scope uses approved scope names, word boundaries and current email evidence', () => {
  const ports=['ALL','NORTHPORT','WESTPORT','DEPOT A'];
  assert.equal(recommendMailScope('North Port registration','What documents?',ports).scope,'NORTHPORT');
  assert.equal(recommendMailScope('Question','Help at depot-a',ports).scope,'DEPOT A');
  assert.equal(recommendMailScope('Question','NORTHPORTAL',ports).scope,'ALL');
  assert.equal(recommendMailScope('Question','EASTPORT registration',ports).scope,'ALL');
  const conflict=recommendMailScope('Northport or Westport','Documents?',ports);
  assert.equal(conflict.scope,'ALL');assert.equal(conflict.needsReview,true);
  assert.equal(recommendMailScope('Question','Documents?\nOn yesterday wrote:\nNORTHPORT',ports).scope,'ALL');
  assert.equal(recommendMailScope('Question','Documents?\n> WESTPORT',ports).scope,'ALL');
  const tentative=recommendMailScope('Registration','What documents?',ports,['ALL','NORTHPORT']);assert.equal(tentative.scope,'NORTHPORT');assert.equal(tentative.needsReview,true);
  assert.equal(recommendMailScope('Registration','What documents?',ports,['NORTHPORT','WESTPORT']).scope,'ALL');
  const registration='PORT KLANG, NORTHPORT, WESTPORT';
  const combined=[registration,'NORTHPORT, WESTPORT, JOHOR','WESTPORT, NORTHPORT'];
  assert.equal(recommendMailScope('Port Klang registration','Company account',combined).scope,registration);
  assert.equal(recommendMailScope('Question','Help at West Port',[registration]).scope,registration);
  assert.equal(recommendMailScope('Question','Northport and Westport',[registration]).scope,registration);
  assert.equal(recommendMailScope('Question','Westport',combined).scope,'ALL','Overlapping labels need more evidence');
  const resolved=recommendMailScope('Company registration at Westport','Please help',combined,[registration]);
  assert.equal(resolved.scope,registration);assert.equal(resolved.needsReview,true);
  assert.equal(recommendMailScope('Question','Northport and Johor',combined,[registration]).scope,'NORTHPORT, WESTPORT, JOHOR','Keyword fallback cannot override conflicting named ports');
});

test('OpenAI configuration is opt-in, source IDs are validated, and prompt data is bounded', () => {
  assert.equal(aiConfiguration({ OPENAI_API_KEY: 'key', AUTO_MAIL_AI_MODEL: 'test-model' }).ready, false);
  assert.equal(aiConfiguration({ AUTO_MAIL_AI_ENABLED: 'true', OPENAI_API_KEY: 'key' }).ready, false);
  assert.equal(aiConfiguration({ AUTO_MAIL_AI_ENABLED: 'true', OPENAI_API_KEY: 'key', AUTO_MAIL_AI_MODEL: 'test-model' }).ready, true);
  assert.throws(() => validateAiOutput({ ...output, cited_source_ids: ['invented-source'] }, sources));
  assert.throws(() => validateAiOutput({ ...output, cited_source_ids: [] }, sources));
  assert.throws(() => validateAiOutput({ ...output, status: 'NO_ANSWER' }, sources));
  assert.equal(validateAiOutput({ ...output, status: 'NO_ANSWER', body_text: '', cited_source_ids: [] }, sources).status, 'NO_ANSWER');
  const thread = presentThread(rawThread(), 'operator@example.com');
  const request = buildAiRequest('test-model', 'ALL', thread, sources);
  assert.equal(request.store, false);
  assert.equal(request.max_output_tokens, 1600);
  assert.equal((request as any).tools, undefined);
  assert.ok(!request.input[0].content.includes('customer@example.com'), 'Sender identity is not included as separate model context');
  assert.match(request.instructions, /untrusted DATA/);
  assert.match(request.instructions, /No live operational evidence/);
  assert.equal(request.text.format.strict, true);
  const changed = structuredClone(thread); changed.messages[0].body += ' changed';
  assert.notEqual(threadSignature(thread), threadSignature(changed));
});

test('OpenAI refusals and incomplete output cannot become drafts; provider errors are sanitized', async () => {
  const original = globalThis.fetch;
  const config = aiConfiguration({ AUTO_MAIL_AI_ENABLED: 'true', OPENAI_API_KEY: 'test-key', AUTO_MAIL_AI_MODEL: 'test-model' });
  try {
    for (const [response, message] of [
      [{ status: 'incomplete' }, /incomplete/],
      [{ status: 'completed', output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'no' }] }] }, /declined/],
      [{ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: 'invalid json' }] }] }, /parsed/],
    ] as const) {
      globalThis.fetch = (async () => new Response(JSON.stringify(response), { status: 200 })) as typeof fetch;
      await assert.rejects(() => generateOpenAiDraft(config, 'ALL', presentThread(rawThread(), 'operator@example.com'), sources), message);
    }
    globalThis.fetch = (async () => new Response('secret upstream error details', { status: 401 })) as typeof fetch;
    await assert.rejects(() => generateOpenAiDraft(config, 'ALL', presentThread(rawThread(), 'operator@example.com'), sources), error => /API key/.test(String(error)) && !String(error).includes('secret upstream'));
  } finally { globalThis.fetch = original; }
});

test('AI migration enforces scoped approved sources, idempotency, leases, provenance and request limits', async () => {
  const db = new PGlite();
  try {
    await db.exec('create role anon;create role authenticated;create role service_role bypassrls;');
    for (const file of ['20261022000000_foundation.sql','20261022010000_gmail_manual_replies.sql','20261022020000_knowledge_base.sql','20261022030000_ai_reply_drafts.sql']) await db.exec(readFileSync(new URL('../supabase/auto-mail/migrations/' + file, import.meta.url), 'utf8'));
    await db.query("insert into auto_mail.mailboxes(id,email) values($1,'operator@example.com')", [mailbox]);
    await db.query("insert into auto_mail.gmail_connections(id,mailbox_id,google_subject,email,refresh_token_ciphertext,token_iv,token_auth_tag,scopes,connected_by,version) values('system',$1,'subject','operator@example.com','cipher','iv','tag','{}',$2,$3)", [mailbox,actor,version]);
    const scalar = async (sql: string, params: unknown[] = []) => Object.values((await db.query<any>(sql, params)).rows[0])[0] as any;
    const create = async (scope: string) => {
      const article = await scalar('select auto_mail.save_knowledge_article(null,null,$1,$2)', [JSON.stringify({ title:'Registration documents',content:'Provide the company certificate.',summary:'Registration',category:'Registration',port:scope,keywords:['registration'] }),actor]);
      return scalar("select auto_mail.review_knowledge_article($1,1,'APPROVE',$2)", [article.id,actor]);
    };
    const general = await create('ALL'); await create('NORTHPORT');
    const matched = await scalar("select auto_mail.match_knowledge_articles('registration','ALL')");
    assert.equal(matched.length,1); assert.equal(matched[0].port,'ALL');
    assert.equal((await scalar("select auto_mail.match_knowledge_articles('registration','NORTHPORT')")).length,2);
    assert.equal((await scalar("select auto_mail.match_knowledge_articles('registration')")).length,2,'Original manual KB search remains compatible');
    const req = { id:requestId, mailbox_id:mailbox,connection_version:version,gmail_thread_id:'thread1',source_message_id:'incoming1',conversation_hash:'hash1',scope:'ALL',provider:'openai',model:'test-model',requested_by:actor,sources:[{id:general.id,version:general.version,title:general.title,port:'ALL',content:general.content}] };
    const claim = (value=req) => scalar('select auto_mail.claim_ai_draft($1)', [JSON.stringify(value)]);
    const finish = (id:string,result:any) => scalar('select auto_mail.finish_ai_draft($1,$2,$3)',[id,actor,JSON.stringify(result)]);
    const validate = (id=requestId,who=actor) => scalar('select auto_mail.validate_ai_draft($1,$2)',[id,who]);
    await db.exec('set role service_role');
    assert.equal((await claim()).claimed,true);
    assert.equal((await claim()).claimed,false,'Identical request does not make another generation');
    await assert.rejects(()=>claim({...req,id:sourceId}),/AI_BUSY/);
    await assert.rejects(()=>finish(requestId,output),/AI_INVALID_OUTPUT/,'Invented source ID is rejected by database too');
    const validOutput={...output,cited_source_ids:[general.id]};
    await finish(requestId,validOutput);
    assert.equal((await validate()).body_text,validOutput.body_text);
    await assert.rejects(()=>validate(requestId,sourceId),/AI_DRAFT_UNAVAILABLE/);
    const delivery={id:sourceId,mailbox_id:mailbox,connection_version:version,gmail_thread_id:'thread1',source_message_id:'incoming1',recipient:'customer@example.com',body_text:'Staff edited reply',requested_by:actor,ai_draft_id:requestId,conversation_hash:'wrong'};
    await assert.rejects(()=>scalar('select auto_mail.claim_manual_reply($1)',[JSON.stringify(delivery)]),/AI_DRAFT_CHANGED/);
    await scalar("select auto_mail.review_knowledge_article($1,2,'ARCHIVE',$2)",[general.id,actor]);
    await assert.rejects(()=>validate(),/AI_SOURCES_CHANGED/);
    await assert.rejects(()=>scalar('select auto_mail.claim_manual_reply($1)',[JSON.stringify({...delivery,conversation_hash:'hash1'})]),/AI_SOURCES_CHANGED/,'Withdrawn source blocks final send admission');
    await scalar("select auto_mail.review_knowledge_article($1,3,'DRAFT',$2)",[general.id,actor]);
    await scalar("select auto_mail.review_knowledge_article($1,4,'APPROVE',$2)",[general.id,actor]);
    const next={...req,id:sourceId,sources:[{...req.sources[0],version:5}]};
    await claim(next);
    await db.exec('reset role');
    await db.query("update auto_mail.ai_reply_drafts set lease_until=now()-interval '1 second' where id=$1",[sourceId]);
    await db.exec('set role service_role');
    const third={...next,id:'10000000-0000-4000-8000-000000000006'};
    await claim(third);
    assert.equal(await scalar('select status from auto_mail.ai_reply_drafts where id=$1',[sourceId]),'FAILED');
    await assert.rejects(()=>finish(sourceId,validOutput),/AI_EXPIRED/);
    await finish(third.id,validOutput);
    await scalar('select auto_mail.claim_manual_reply($1)',[JSON.stringify({...delivery,ai_draft_id:third.id,conversation_hash:'hash1'})]);
    assert.equal(await scalar('select ai_draft_id from auto_mail.reply_deliveries where id=$1',[delivery.id]),third.id);
    await assert.rejects(()=>validate(third.id),/AI_ALREADY_REPLIED/);
    await assert.rejects(()=>db.exec("update auto_mail.ai_reply_drafts set body_text='tampered'"),/permission denied/);
    await db.exec('reset role');
    await db.query("insert into auto_mail.ai_reply_drafts(id,mailbox_id,connection_version,gmail_thread_id,source_message_id,conversation_hash,scope,provider,model,requested_by,status,sources) select gen_random_uuid(),$1,$2,'other-thread','other-message','hash','ALL','openai','model',$3,'FAILED',$4::jsonb from generate_series(1,17)",[mailbox,version,actor,JSON.stringify(next.sources)]);
    await assert.rejects(()=>claim({...next,id:'10000000-0000-4000-8000-000000000007',source_message_id:'different'}),/AI_RATE_LIMIT/);
    assert.equal(await scalar("select has_function_privilege('authenticated','auto_mail.claim_ai_draft(jsonb)','EXECUTE')"),false);
    assert.equal(await scalar('select schema_version from auto_mail.settings'),4);
    assert.equal(await scalar('select reply_mode from auto_mail.settings'),'DRAFT_ONLY');
  } finally { await db.close(); }
});

test('AI handlers use actual thread context, skip OpenAI without sources, and cannot send email', async () => {
  const overrides={AUTO_MAIL_ENABLED:'true',AUTO_MAIL_SUPABASE_URL:'https://ai-dev.supabase.co',AUTO_MAIL_SUPABASE_SERVICE_ROLE_KEY:'test-key',SUPABASE_URL:'https://main.supabase.co',VITE_SUPABASE_URL:'https://main.supabase.co',VERCEL_ENV:'development',AUTO_MAIL_APP_URL:'http://localhost:3000',GOOGLE_OAUTH_CLIENT_ID:'test-client',GOOGLE_OAUTH_CLIENT_SECRET:'test-secret',GOOGLE_TOKEN_ENCRYPTION_KEY:Buffer.alloc(32,4).toString('base64'),SESSION_SECRET:'ai-test-secret',AUTO_MAIL_AI_ENABLED:'true',OPENAI_API_KEY:'test-openai-key',AUTO_MAIL_AI_MODEL:'server-model'};
  const before=Object.fromEntries(Object.keys(overrides).map(key=>[key,process.env[key]]));Object.assign(process.env,overrides);
  const realFetch=globalThis.fetch;
  const connection={id:'system',mailbox_id:mailbox,version,email:'operator@example.com',...encryptRefreshToken('fake-refresh')};
  let noSources=true;let claims=0;let providerCalls=0;let failed=0;let changed=false;let dbSourceChanged=false;let saved:any=null;let storedSettings:any=null;let disableDuringProvider=false;
  globalThis.fetch=(async(input:any,init:any={})=>{
    const url=String(input);
    const json=(value:any,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});
    assert.ok(!url.includes('main.supabase.co'));
    assert.ok(!url.includes('/messages/send'),'Draft handlers must never send email');
    if(url.includes('/agent_settings'))return storedSettings?json(storedSettings):json({code:'PGRST205',message:'Table not found'},404);
    if(url.includes('/gmail_connections'))return json(connection);
    if(url.includes('/knowledge_articles'))return json([{port:'ALL'},{port:'NORTHPORT'},{port:'WESTPORT'}]);
    if(url==='https://oauth2.googleapis.com/token')return json({access_token:'fake-access'});
    if(url.includes('/threads/thread1')){const thread=rawThread();if(changed)thread.messages[0].id='new-message';return json(thread);}
    if(url.includes('/match_knowledge_articles')){assert.ok(['ALL',''].includes(JSON.parse(init.body).p_port));return json(noSources?[]:sources);}
    if(url.includes('/claim_ai_draft')){claims++;const req=JSON.parse(init.body).p_request;saved={...req,status:'GENERATING',body_text:'',review_notes:'',cited_source_ids:[]};return json({claimed:true,draft:saved});}
    if(url==='https://api.openai.com/v1/responses'){
      providerCalls++;const request=JSON.parse(init.body);assert.equal(request.model,storedSettings?.model||'server-model');if(disableDuringProvider)storedSettings.enabled=false;assert.equal(request.store,false);assert.ok(!request.tools);assert.ok(request.input[0].content.includes('What registration documents'));
      return json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(output)}]}]});
    }
    if(url.includes('/finish_ai_draft')){if(dbSourceChanged)return json({message:'AI_SOURCES_CHANGED'},400);saved={...saved,...JSON.parse(init.body).p_result};return json(saved);}
    if(url.includes('/validate_ai_draft'))return json(saved);
    if(url.includes('/fail_ai_draft')){failed++;return json(null);}
    throw new Error('Unexpected test endpoint');
  }) as typeof fetch;
  const cookie='cargomove_session='+signSession({id:actor,email:'admin@example.com',type:'ADMIN',exp:Date.now()+60000});
  const body={requestId,threadId:'thread1',sourceMessageId:'incoming1',connectionVersion:version,scope:'ALL',model:'attacker-model',sources:[{id:'untrusted'}]};
  const invoke=async(handler:any,payload:any=body,headers:any={cookie,origin:'http://localhost:3000'})=>{const res={code:200,value:null as any,setHeader(){},status(code:number){this.code=code;return this;},json(value:any){this.value=value;}};await handler({method:'POST',headers,body:payload},res);return res;};
  try{
    assert.equal((await invoke(aiGenerate,body,{})).code,401);
    assert.equal((await invoke(aiGenerate,body,{cookie,origin:'https://evil.example'})).code,403);
    process.env.AUTO_MAIL_AI_ENABLED='false';assert.equal((await invoke(aiGenerate)).code,503);assert.equal(providerCalls,0);process.env.AUTO_MAIL_AI_ENABLED='true';
    assert.equal((await invoke(aiGenerate)).value.state,'NO_SOURCES');assert.equal(claims,0);assert.equal(providerCalls,0);
    noSources=false;const generated=await invoke(aiGenerate);assert.equal(generated.value.draft.status,'READY');assert.equal(providerCalls,1);
    const preview=await invoke(aiScope,{threadId:'thread1',sourceMessageId:'incoming1',connectionVersion:version});
    assert.equal(preview.value.recommendation.scope,'ALL');assert.equal(providerCalls,1,'Reading scope never calls the AI provider');
    const automatic=await invoke(aiGenerate,{...body,scope:''});assert.equal(automatic.value.draft.status,'NEEDS_REVIEW');assert.equal(automatic.value.draft.scope,'ALL');
    assert.match(automatic.value.draft.reviewNotes,/No clear port/);
    assert.equal((await invoke(aiUse,{draftId:requestId,threadId:'thread1',connectionVersion:version})).value.draft.body,output.body_text);
    changed=true;assert.equal((await invoke(aiUse,{draftId:requestId,threadId:'thread1',connectionVersion:version})).code,409);changed=false;
    dbSourceChanged=true;assert.equal((await invoke(aiGenerate)).code,409);assert.equal(failed,1,'Rejected generation is released without a second model call');
    dbSourceChanged=false;storedSettings={enabled:false,model:'admin-model',enabled_models:['admin-model'],version:1};
    const beforeDisable=providerCalls;assert.equal((await invoke(aiGenerate)).code,503);assert.equal(providerCalls,beforeDisable,'Disabled agent cannot call OpenAI');
    storedSettings.enabled=true;assert.equal((await invoke(aiGenerate)).value.draft.model,'admin-model','Generation uses the saved administrator model');
    disableDuringProvider=true;assert.equal((await invoke(aiGenerate)).code,409);assert.equal(failed,2,'Disabling during generation invalidates the unfinished draft');
  }finally{globalThis.fetch=realFetch;for(const key of Object.keys(overrides)){if(before[key]===undefined)delete process.env[key];else process.env[key]=before[key];}}
});
