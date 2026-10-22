import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import crypto from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { composeMessage, listOutbox, cancelOutbox, runOutbox, deliverOutbox } from '../server-handlers/auto-mail/outbox.js';
import mailboxActions from '../server-handlers/auto-mail/mailbox-actions.js';
import { READ_SCOPE, SEND_SCOPE, MODIFY_SCOPE } from '../server-handlers/auto-mail/gmail.js';
import { encryptMailboxToken } from '../server-handlers/auto-mail/token-encryption.js';
import { signSession } from '../api/_runtime.js';

const actor='10000000-0000-4000-8000-000000000001',mailbox='10000000-0000-4000-8000-000000000002',version='10000000-0000-4000-8000-000000000003',id='10000000-0000-4000-8000-000000000004';
test('outbox SQL claims once, cancels only queued messages, records receipts and quarantines interrupted sends without changing old tables',async()=>{
  const db=new PGlite();
  try {
    await db.exec("create role anon;create role authenticated;create role service_role bypassrls;create schema storage;create table storage.buckets(id text,name text,public boolean,file_size_limit bigint);create table storage.objects(bucket_id text);alter table storage.objects enable row level security;create table public.untouched(value text);insert into public.untouched values('original');");
    for(const name of ['20261022000000_foundation.sql','20261022070000_compose_outbox.sql'])await db.exec(readFileSync(new URL('../supabase/auto-mail/migrations/'+name,import.meta.url),'utf8'));
    await db.query("insert into auto_mail.mailboxes(id,email) values($1,'operator@example.com')",[mailbox]);
    const insert=async(key:string,when:string)=>db.query("insert into auto_mail.outbox_messages(id,actor_id,mailbox_id,connection_version,subject,to_addresses,body_text,raw_path,raw_sha256,scheduled,send_at) values($1::uuid,$2,$3,$4,'New message',array['customer@example.com'],'Hello',($1::uuid)::text,$5,true,$6)",[key,actor,mailbox,version,'a'.repeat(64),when]);
    await insert(id,'2020-01-01');
    await db.exec('set role service_role');
    assert.equal((await db.query<any>('select auto_mail.claim_outbox_message() as job')).rows[0].job.id,id);
    assert.equal((await db.query<any>('select auto_mail.claim_outbox_message() as job')).rows[0].job,null);
    await assert.rejects(()=>db.query('select auto_mail.cancel_outbox_message($1,$2)',[id,mailbox]),/OUTBOX_ALREADY_STARTED/);
    await db.query("select auto_mail.finish_outbox_message($1,'SENT','gmail1','thread1','')",[id]);
    await assert.rejects(()=>db.query("select auto_mail.finish_outbox_message($1,'SENT','gmail1')",[id]),/OUTBOX_CONFLICT/);
    await assert.rejects(()=>db.exec("update auto_mail.outbox_messages set status='QUEUED'"),/permission denied/);
    const second='20000000-0000-4000-8000-000000000004';await insert(second,'2099-01-01');
    assert.equal((await db.query<any>('select auto_mail.claim_outbox_message() as job')).rows[0].job,null);
    await assert.rejects(()=>db.query('select auto_mail.cancel_outbox_message($1,$2)',[second,actor]),/OUTBOX_ALREADY_STARTED/);
    await db.query('select auto_mail.cancel_outbox_message($1,$2)',[second,mailbox]);
    await db.exec('reset role');
    const third='30000000-0000-4000-8000-000000000004';await insert(third,'2020-01-01');
    await db.query("update auto_mail.outbox_messages set status='SENDING',started_at=now()-interval '11 minutes' where id=$1",[third]);
    await db.query('select auto_mail.claim_outbox_message()');
    assert.equal((await db.query<any>('select status from auto_mail.outbox_messages where id=$1',[third])).rows[0].status,'UNCERTAIN');
    assert.equal((await db.query<any>('select value from public.untouched')).rows[0].value,'original');
    assert.equal((await db.query<any>("select has_function_privilege('authenticated','auto_mail.claim_outbox_message(uuid)','EXECUTE') as allowed")).rows[0].allowed,false);
    await db.exec("grant usage on schema storage to authenticated;grant select on storage.objects to authenticated;create policy existing_broad on storage.objects for select to authenticated using(true);insert into storage.objects values('old-bucket'),('auto-mail-outbox');set role authenticated;");
    assert.deepEqual((await db.query<any>('select bucket_id from storage.objects')).rows.map(row=>row.bucket_id),['old-bucket']);
  }finally{await db.close();}
});

test('compose, scheduled queue and Trash handlers enforce auth, origin, scopes and idempotent MIME delivery without real Gmail',async()=>{
  const env={AUTO_MAIL_ENABLED:'true',AUTO_MAIL_SUPABASE_URL:'https://outbox-dev.supabase.co',AUTO_MAIL_SUPABASE_SERVICE_ROLE_KEY:'test',SUPABASE_URL:'https://main.supabase.co',VITE_SUPABASE_URL:'https://main.supabase.co',AUTO_MAIL_APP_URL:'http://localhost:3000',GOOGLE_OAUTH_CLIENT_ID:'client',GOOGLE_OAUTH_CLIENT_SECRET:'secret',GOOGLE_TOKEN_ENCRYPTION_KEY:Buffer.alloc(32,1).toString('base64'),SESSION_SECRET:'outbox-test',AUTO_MAIL_SCHEDULER_SECRET:'x'.repeat(40)};
  const before=Object.fromEntries(Object.keys(env).map(key=>[key,process.env[key]]));Object.assign(process.env,env);const original=globalThis.fetch;
  const connection={mailbox_id:mailbox,version,email:'operator@example.com',scopes:[READ_SCOPE,SEND_SCOPE],...encryptMailboxToken('refresh')};
  let job:any=null,bytes=Buffer.alloc(0),sends=0,heartbeat=true,trashCalls=0;const calls:string[]=[];const labelChanges:any[]=[];
  globalThis.fetch=(async(input:any,init:any={})=>{
    const url=new URL(String(input));calls.push(url.href);assert.ok(!url.hostname.includes('main.supabase'),'Main DB is untouched');
    const json=(value:any,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});
    if(url.pathname.endsWith('/gmail_connections'))return json(connection);
    if(url.pathname.endsWith('/outbox_worker_state'))return json({last_seen:new Date(Date.now()-(heartbeat?0:600000)).toISOString()});
    if(url.pathname.endsWith('/outbox_messages')){if(init.method==='POST'){job={...JSON.parse(init.body),status:'QUEUED'};return json(null,201);}return json(url.searchParams.has('id')?job:job?[job]:[]);}
    if(url.pathname.includes('/storage/v1/object/')){if(init.method==='POST'){bytes=Buffer.from(init.body);return json({Key:'private'});}return new Response(bytes,{headers:{'Content-Type':'application/octet-stream'}});}
    if(url.pathname.endsWith('/rpc/claim_outbox_message')){if(!job||job.status!=='QUEUED'||Date.parse(job.send_at)>Date.now())return json(null);job.status='SENDING';return json(job);}
    if(url.pathname.endsWith('/rpc/finish_outbox_message')){const body=JSON.parse(init.body);job.status=body.p_status;return json(null);}
    if(url.pathname.endsWith('/rpc/cancel_outbox_message')){job.status='CANCELLED';return json(null);}
    if(url.pathname.endsWith('/rpc/outbox_worker_heartbeat'))return json(null);
    if(url.hostname==='oauth2.googleapis.com')return json({access_token:'token'});
    if(url.pathname.endsWith('/messages/send')){sends++;const raw=Buffer.from(JSON.parse(init.body).raw,'base64url').toString();assert.ok(!raw.includes('In-Reply-To:'));assert.ok(!raw.includes('References:'));assert.match(raw,/To: customer@example.com/);assert.match(raw,/Cc: team@example.com/);assert.match(raw,/Bcc: hidden@example.com/);assert.ok(raw.includes(Buffer.from('New subject').toString('base64')));return json({id:'gmail1',threadId:'thread1'});}
    if(url.pathname.endsWith('/modify')){assert.equal(init.method,'POST');assert.equal(init.headers['Content-Type'],'application/json');labelChanges.push(JSON.parse(init.body));return url.pathname.includes('badthread')?json({},500):json({id:'thread1'});}
    if(url.pathname.endsWith('/trash')||url.pathname.endsWith('/untrash')){trashCalls++;assert.equal(init.method,'POST');assert.ok(!url.pathname.endsWith('/delete'));return url.pathname.includes('badthread')?json({},500):json({id:'thread1'});}
    throw new Error('Unexpected URL '+url.pathname);
  }) as typeof fetch;
  const cookie='cargomove_session='+signSession({id:actor,email:'admin@example.com',type:'ADMIN',exp:Date.now()+60000});
  const invoke=async(handler:any,body:any={},headers:any={cookie,origin:'http://localhost:3000'},method='POST')=>{let code=200,result:any;await handler({method,headers,body,query:{}},{setHeader(){},status(value:number){code=value;return this;},json(value:any){result=value;}});return{code,result};};
  const message={requestId:id,connectionVersion:version,to:'customer@example.com',cc:'team@example.com',bcc:'hidden@example.com',subject:'New subject',bodyHtml:'<p>Hello</p><script>evil()</script>',attachmentIds:[]};
  try {
    for(const handler of [composeMessage,listOutbox,cancelOutbox,mailboxActions])assert.equal((await invoke(handler,{},{})).code,401);
    assert.equal((await invoke(composeMessage,message,{cookie,origin:'https://attacker.test'})).code,403);assert.equal(calls.length,0);
    assert.equal((await invoke(runOutbox,{},{})).code,401);
    assert.equal((await invoke(composeMessage,{...message,subject:'Injected\r\nBcc: attacker@example.com'})).code,400);
    assert.equal((await invoke(composeMessage,{...message,connectionVersion:actor})).code,409);
    assert.equal((await invoke(composeMessage,message)).result.status,'SENT');assert.equal(sends,1);
    assert.equal((await invoke(composeMessage,message)).result.status,'SENT');assert.equal(sends,1,'Same request cannot resend');
    job=null;heartbeat=false;
    assert.equal((await invoke(composeMessage,{...message,sendAt:new Date(Date.now()+600000).toISOString()})).code,409);assert.equal(sends,1);
    heartbeat=true;
    assert.equal((await invoke(composeMessage,{...message,sendAt:new Date(Date.now()+600000).toISOString()})).result.status,'QUEUED');assert.equal(sends,1,'Scheduling does not send early');
    assert.equal((await invoke(cancelOutbox,{id,connectionVersion:version})).result.status,'CANCELLED');
    assert.equal((await invoke(runOutbox,{}, {authorization:'Bearer '+env.AUTO_MAIL_SCHEDULER_SECRET})).result.processed,0);
    assert.equal((await invoke(mailboxActions,{ids:['thread1'],action:'trash',connectionVersion:version})).code,409);assert.equal(trashCalls,0);
    for(const action of ['read','unread'])assert.equal((await invoke(mailboxActions,{ids:['thread1'],action,connectionVersion:version})).code,409);
    assert.equal(labelChanges.length,0);
    connection.scopes.push(MODIFY_SCOPE);
    assert.equal((await invoke(mailboxActions,{ids:['thread1'],action:'unread',connectionVersion:actor})).code,409);
    assert.equal((await invoke(mailboxActions,{ids:['../thread'],action:'unread',connectionVersion:version})).code,400);
    assert.equal(labelChanges.length,0);
    for(const action of ['read','unread'])assert.deepEqual((await invoke(mailboxActions,{ids:['thread1'],action,connectionVersion:version})).result.completed,['thread1']);
    assert.deepEqual(labelChanges,[{removeLabelIds:['UNREAD']},{addLabelIds:['UNREAD']}]);
    const labelPartial=await invoke(mailboxActions,{ids:['thread1','badthread'],action:'unread',connectionVersion:version});
    assert.deepEqual(labelPartial.result.completed,['thread1']);assert.deepEqual(labelPartial.result.failed,['badthread']);
    const partial=await invoke(mailboxActions,{ids:['thread1','badthread'],action:'trash',connectionVersion:version});assert.deepEqual(partial.result.completed,['thread1']);assert.deepEqual(partial.result.failed,['badthread']);
    assert.equal((await invoke(mailboxActions,{ids:['thread1'],action:'restore',connectionVersion:version})).result.completed.length,1);
  }finally{globalThis.fetch=original;for(const key of Object.keys(env)){if(before[key]===undefined)delete process.env[key];else process.env[key]=before[key];}}
});

test('delivery rejects changed snapshots/mailboxes before send and never retries an uncertain provider call',async()=>{
  const env={AUTO_MAIL_APP_URL:'http://localhost:3000',GOOGLE_OAUTH_CLIENT_ID:'test',GOOGLE_OAUTH_CLIENT_SECRET:'test',GOOGLE_TOKEN_ENCRYPTION_KEY:Buffer.alloc(32,1).toString('base64')};
  const before=Object.fromEntries(Object.keys(env).map(key=>[key,process.env[key]]));Object.assign(process.env,env);const original=globalThis.fetch;
  let sends=0,result:any;const bytes=Buffer.from('Prepared message');
  const connection={mailbox_id:mailbox,version,email:'operator@example.com',scopes:[SEND_SCOPE],...encryptMailboxToken('refresh')};
  const client={from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:connection})})})}),storage:{from:()=>({download:async()=>({data:new Blob([bytes])})})},rpc:async(_name:string,args:any)=>{result=args;return{};}};
  const job={id,mailbox_id:mailbox,connection_version:version,raw_path:'private',raw_sha256:crypto.createHash('sha256').update(bytes).digest('hex')};
  globalThis.fetch=(async(input:any)=>{if(String(input).includes('oauth2.googleapis.com'))return new Response(JSON.stringify({access_token:'token'}));sends++;throw new Error('Timeout after provider may have accepted');}) as typeof fetch;
  try {
    assert.equal((await deliverOutbox(client,{...job,connection_version:actor})).status,'FAILED');assert.equal(sends,0);
    assert.equal((await deliverOutbox(client,{...job,raw_sha256:'b'.repeat(64)})).status,'FAILED');assert.equal(sends,0);
    assert.equal((await deliverOutbox(client,job)).status,'UNCERTAIN');assert.equal(sends,1);assert.equal(result.p_status,'UNCERTAIN');
  }finally{globalThis.fetch=original;for(const key of Object.keys(env)){if(before[key]===undefined)delete process.env[key];else process.env[key]=before[key];}}
});
