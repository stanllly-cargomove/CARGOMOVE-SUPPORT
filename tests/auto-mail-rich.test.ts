import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { cleanMailHtml, mailHtmlText, replyRecipients, richRawReply } from '../server-handlers/auto-mail/mail-content.js';
import { presentThread, gmailReply } from '../server-handlers/auto-mail/gmail.js';
import { loadReplyFiles, uploadMetadata } from '../server-handlers/auto-mail/file-storage.js';
import { attachmentRead, attachmentUpload, attachmentRemove } from '../server-handlers/auto-mail/attachments.js';
import { encryptMailboxToken } from '../server-handlers/auto-mail/token-encryption.js';
import { signSession } from '../api/_runtime.js';
import { spawnSync } from 'node:child_process';

const actor='10000000-0000-4000-8000-000000000001',mailbox='10000000-0000-4000-8000-000000000002',version='10000000-0000-4000-8000-000000000003',requestId='10000000-0000-4000-8000-000000000004',fileId='10000000-0000-4000-8000-000000000005';
const incoming=()=>({id:'thread1',messages:[{id:'message1',internalDate:'1792600000000',labelIds:['INBOX'],payload:{mimeType:'multipart/mixed',headers:[{name:'From',value:'Customer <customer@example.com>'},{name:'To',value:'operator@example.com, colleague@example.com'},{name:'Cc',value:'team@example.com'},{name:'Subject',value:'Documents'},{name:'Message-ID',value:'<incoming@example.com>'}],parts:[{partId:'0',mimeType:'text/html',body:{data:Buffer.from('<p>Please read <a href="https://example.com/help">the instructions</a>.</p><script>evil()</script><img src="https://tracker.test/x">').toString('base64url')}},{partId:'1',mimeType:'application/pdf',filename:'guide.pdf',body:{attachmentId:'google-attachment',size:12}}]}}]});

test('shared email function starts without native require(ESM) support, matching Vercel',()=>{
  const result=spawnSync(process.execPath,['--no-experimental-require-module','--import','tsx','--input-type=module','-e',`import router from './api/mail.ts';const res={code:200,setHeader(){},status(code){this.code=code;return this;},json(){}};await router({method:'GET',query:{route:'auto-mail/status'},headers:{}},res);if(res.code!==401)throw new Error('Authentication gate was not reached');console.log('ready');`],{cwd:process.cwd(),encoding:'utf8',timeout:20000});
  assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/ready/);
});

test('HTML-only reading preserves tables and links, strips active content/tracking, and exposes CC and file metadata',()=>{
  const view=presentThread(incoming(),'operator@example.com');
  assert.match(view.messages[0].body,/Please read/);assert.match(view.messages[0].body,/https:\/\/example.com\/help/);
  assert.ok(!view.messages[0].html.includes('script'));assert.ok(!view.messages[0].html.includes('tracker'));
  assert.equal(view.messages[0].cc,'team@example.com');assert.deepEqual(view.messages[0].files,[{partId:'1',name:'guide.pdf',type:'application/pdf',size:12}]);
  const html=cleanMailHtml('<table><tr><td onclick="evil()" style="position:fixed;color:red;background-image:url(https://tracker.test)">A</td></tr></table><a href="javascript:evil()">Bad</a><iframe srcdoc="x"></iframe>');
  assert.match(html,/<table>/);assert.match(html,/color:red/);assert.ok(!/onclick|position|tracker|javascript|iframe/.test(html));
  assert.equal(mailHtmlText('<p>Hello <b>team</b></p>'),'Hello team');
});
test('rich MIME includes verified recipients, alternatives, threading and exact attachment bytes',()=>{
  const recipients=replyRecipients({to:'"Customer, Team" <customer@example.com>, colleague@example.com',cc:'colleague@example.com, team@example.com',bcc:'hidden@example.com'},'customer@example.com','operator@example.com');
  assert.deepEqual(recipients.cc,['team@example.com']);
  assert.throws(()=>replyRecipients({to:'other@example.com'},'customer@example.com','operator@example.com'));
  assert.throws(()=>replyRecipients({cc:'team@example.com\r\nBcc: attacker@example.com'},'customer@example.com','operator@example.com'));
  const raw=Buffer.from(richRawReply('operator@example.com',{subject:'Documents',messageId:'<incoming@example.com>',references:'<incoming@example.com>'},recipients,'Hello','<p><b>Hello</b></p>',[{id:fileId,name:'guide.pdf',type:'application/pdf',size:12,data:Buffer.from('%PDF-hello!!')}],requestId),'base64url').toString();
  assert.match(raw,/Cc: team@example.com/);assert.match(raw,/Bcc: hidden@example.com/);assert.match(raw,/multipart\/mixed/);assert.match(raw,/multipart\/alternative/);assert.match(raw,/In-Reply-To: <incoming@example.com>/);assert.match(raw,/filename="guide.pdf"/);assert.ok(raw.includes(Buffer.from('%PDF-hello!!').toString('base64')));
});
test('uploaded files are bound to actor, mailbox, connection and reply request and must match stored sizes',async()=>{
  assert.equal(uploadMetadata({name:'guide.pdf',size:12}).mime_type,'application/pdf');assert.throws(()=>uploadMetadata({name:'script.html',size:12}));
  const row={id:fileId,request_id:requestId,mailbox_id:mailbox,connection_version:version,gmail_thread_id:'thread1',source_message_id:'message1',expires_at:new Date(Date.now()+60000).toISOString(),name:'guide.pdf',mime_type:'application/pdf',size:12,path:'private/file'};
  let size=12;let reads=0;
  const client={from:()=>({select:()=>({in:()=>({eq:async(_field:string,value:string)=>{assert.equal(value,actor);return {data:[row],error:null};}})})}),storage:{from:()=>({download:async()=>{reads++;return{data:new Blob([Buffer.alloc(size)]),error:null};}})}};
  const context={id:requestId,actor,connection:{mailbox_id:mailbox,version},threadId:'thread1',sourceMessageId:'message1'};
  assert.equal((await loadReplyFiles(client,[fileId],context))[0].data.length,12);
  await assert.rejects(()=>loadReplyFiles(client,[fileId],{...context,id:actor}),/context changed/);assert.equal(reads,1);
  size=11;await assert.rejects(()=>loadReplyFiles(client,[fileId],context),/incomplete/);
});
test('rich delivery claim atomically snapshots recipients and files and rejects forged uploads without touching main tables',async()=>{
  const db=new PGlite();
  try{
    await db.exec("create role anon;create role authenticated;create role service_role bypassrls;create schema storage;create table storage.buckets(id text,name text,public boolean,file_size_limit bigint);create table storage.objects(bucket_id text);alter table storage.objects enable row level security;create table public.untouched(value text);insert into public.untouched values('original');");
    for(const name of ['20261022000000_foundation.sql','20261022010000_gmail_manual_replies.sql','20261022020000_knowledge_base.sql','20261022030000_ai_reply_drafts.sql','20261022040000_reviewed_learning.sql','20261022060000_rich_replies.sql'])await db.exec(readFileSync(new URL('../supabase/auto-mail/migrations/'+name,import.meta.url),'utf8'));
    await db.query("insert into auto_mail.mailboxes(id,email) values($1,'operator@example.com')",[mailbox]);
    await db.query("insert into auto_mail.gmail_connections(id,mailbox_id,google_subject,email,refresh_token_ciphertext,token_iv,token_auth_tag,scopes,connected_by,version) values('system',$1,'google','operator@example.com','cipher','iv','tag','{}',$2,$3)",[mailbox,actor,version]);
    const delivery={id:requestId,mailbox_id:mailbox,connection_version:version,gmail_thread_id:'thread1',source_message_id:'message1',recipient:'customer@example.com',body_text:'Hello',requested_by:actor};
    const file={id:fileId,name:'guide.pdf',type:'application/pdf',size:12,path:'outgoing/private',sha256:'a'.repeat(64)};
    await db.query("insert into auto_mail.reply_uploads(id,request_id,actor_id,mailbox_id,connection_version,gmail_thread_id,source_message_id,path,name,mime_type,size) values($1,$2,$3,$4,$5,'thread1','message1',$6,'guide.pdf','application/pdf',12)",[fileId,requestId,actor,mailbox,version,file.path]);
    const detail={to:['customer@example.com'],cc:['team@example.com'],bcc:['hidden@example.com'],html:'<p>Hello</p>',attachments:[file]};
    const claim=(d:any=delivery,f:any=detail)=>db.query('select auto_mail.claim_rich_reply($1,$2)',[JSON.stringify(d),JSON.stringify(f)]);
    await db.exec('set role service_role');
    await assert.rejects(()=>claim({...delivery,requested_by:mailbox}),/REPLY_UPLOAD_CHANGED/);
    await assert.rejects(()=>claim(delivery,{...detail,attachments:[{...file,size:13}]}),/REPLY_UPLOAD_CHANGED/);
    await claim();assert.equal((await db.query<any>('select cc_addresses from auto_mail.reply_details')).rows[0].cc_addresses[0],'team@example.com');
    await assert.rejects(()=>claim(),/duplicate key/);
    await assert.rejects(()=>db.exec('delete from auto_mail.reply_details'),/permission denied/);
    await db.exec('reset role');assert.equal((await db.query<any>('select value from public.untouched')).rows[0].value,'original');
    assert.equal((await db.query<any>("select has_function_privilege('authenticated','auto_mail.claim_rich_reply(jsonb,jsonb)','EXECUTE') as allowed")).rows[0].allowed,false);
    await db.exec("grant usage on schema storage to authenticated;grant select on storage.objects to authenticated;create policy existing_broad_policy on storage.objects for select to authenticated using(true);insert into storage.objects values('other-project-bucket'),('auto-mail-attachments');set role authenticated;");
    assert.deepEqual((await db.query<any>('select bucket_id from storage.objects')).rows.map(row=>row.bucket_id),['other-project-bucket'],'Existing Storage policies still work for old buckets while the new mailbox bucket is isolated');
  }finally{await db.close();}
});
test('attachment and rich send endpoints enforce admin, origin, conversation ownership and server-side MIME before Gmail',async()=>{
  const env={AUTO_MAIL_ENABLED:'true',AUTO_MAIL_SUPABASE_URL:'https://rich-dev.supabase.co',AUTO_MAIL_SUPABASE_SERVICE_ROLE_KEY:'test-key',SUPABASE_URL:'https://main.supabase.co',VITE_SUPABASE_URL:'https://main.supabase.co',AUTO_MAIL_APP_URL:'http://localhost:3000',GOOGLE_OAUTH_CLIENT_ID:'client',GOOGLE_OAUTH_CLIENT_SECRET:'secret',GOOGLE_TOKEN_ENCRYPTION_KEY:Buffer.alloc(32,1).toString('base64'),SESSION_SECRET:'rich-test-session'};
  const before=Object.fromEntries(Object.keys(env).map(key=>[key,process.env[key]]));Object.assign(process.env,env);const original=globalThis.fetch;
  const connection={mailbox_id:mailbox,version,email:'operator@example.com',scopes:['https://www.googleapis.com/auth/gmail.readonly','https://www.googleapis.com/auth/gmail.send'],...encryptMailboxToken('refresh')};let sends=0;let raw='';let storageWrites=0;let claims=0;let upload:any=null;
  globalThis.fetch=(async(input:any,init:any={})=>{
    const url=String(input);assert.ok(!url.includes('main.supabase.co'));const json=(value:any,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});
    if(url.includes('/gmail_connections'))return json(connection);
    if(url==='https://oauth2.googleapis.com/token')return json({access_token:'access'});
    if(url.includes('/threads/thread1'))return json(incoming());
    if(url.includes('/messages/message1/attachments/'))return json({data:Buffer.from('%PDF-hello!!').toString('base64url')});
    if(url.includes('/reply_uploads')){
      if(init.method==='POST'){upload={...JSON.parse(init.body),expires_at:new Date(Date.now()+60000).toISOString()};return json(null,201);}
      if(init.method==='DELETE'){upload=null;return new Response(null,{status:204});}
      if(new URL(url).searchParams.get('select')==='size')return json([]);
      return json(new URL(url).searchParams.get('id')?.startsWith('in.')?[upload]:upload);
    }
    if(url.includes('/reply_deliveries'))return json(null);
    if(url.includes('/object/upload/sign/'))return json({url:'/object/upload/sign/private/file?token=signed-upload'});
    if(url.includes('/storage/v1/object/')&&(!init.method||init.method==='GET'))return new Response('%PDF-hello!!',{headers:{'Content-Type':'application/pdf'}});
    if(url.includes('/object/sign/'))return json({signedURL:'/object/sign/private/file?token=private'});
    if(url.includes('/storage/v1/object/')){storageWrites++;return json({Key:'private/file'});}
    if(url.includes('/claim_rich_reply')){claims++;const body=JSON.parse(init.body);assert.deepEqual(body.p_detail.cc,['team@example.com']);assert.ok(!body.p_detail.html.includes('script'));return json(requestId);}
    if(url.includes('/messages/send')){sends++;raw=Buffer.from(JSON.parse(init.body).raw,'base64url').toString();return json({id:'sent-id'});}
    if(url.includes('/finish_manual_reply'))return json({learning_queued:false});
    throw new Error('Unexpected rich-mail endpoint: '+url);
  }) as typeof fetch;
  const cookie='cargomove_session='+signSession({id:actor,email:'admin@example.com',type:'ADMIN',exp:Date.now()+60000});
  const invoke=async(handler:any,method:string,body:any={},query:any={},headers:any={cookie,origin:'http://localhost:3000'})=>{const res={code:200,value:null as any,setHeader(){},status(code:number){this.code=code;return this;},json(value:any){this.value=value;}};await handler({method,body,query,headers},res);return res;};
  try{
    for(const handler of [attachmentRead,attachmentUpload,attachmentRemove])assert.equal((await invoke(handler,'POST',{},{},{})).code,401);
    assert.equal((await invoke(attachmentUpload,'POST',{}, {},{cookie,origin:'https://evil.test'})).code,403);
    const wrong=await invoke(attachmentRead,'GET',{}, {threadId:'thread1',messageId:'message1',partId:'wrong'});assert.equal(wrong.code,404);assert.equal(storageWrites,0);
    const read=await invoke(attachmentRead,'GET',{}, {threadId:'thread1',messageId:'message1',partId:'1'});assert.equal(read.code,200);assert.equal(read.value.type,'application/pdf');assert.equal(read.value.previewable,true);
    const registration={name:'guide.pdf',size:12,requestId,threadId:'thread1',sourceMessageId:'message1',connectionVersion:version,actor_id:'attacker'};
    const registered=await invoke(attachmentUpload,'POST',registration);assert.equal(registered.code,200);assert.equal(upload.actor_id,actor);assert.ok(upload.path.includes(actor));assert.ok(!JSON.stringify(registered.value).includes('test-key'));
    assert.equal((await invoke(attachmentRemove,'POST',{id:registered.value.id})).value.removed,true);
    await invoke(attachmentUpload,'POST',registration);
    const body={threadId:'thread1',sourceMessageId:'message1',connectionVersion:version,requestId,recipient:'customer@example.com',body:'Hello',bodyHtml:'<p><b>Hello</b></p><script>evil()</script>',cc:'team@example.com',bcc:'hidden@example.com',attachmentIds:[upload.id]};
    const invalid=await invoke(gmailReply,'POST',{...body,cc:'bad\r\nBCC: x@example.com'});assert.equal(invalid.code,400);assert.equal(invalid.value.canEditReply,true);assert.equal(claims,0);assert.equal(sends,0);
    const sent=await invoke(gmailReply,'POST',body);assert.equal(sent.value.status,'SENT',JSON.stringify(sent.value));assert.equal(sends,1);assert.match(raw,/Cc: team@example.com/);assert.match(raw,/Bcc: hidden@example.com/);assert.match(raw,/multipart\/alternative/);assert.match(raw,/multipart\/mixed/);assert.ok(raw.includes(Buffer.from('%PDF-hello!!').toString('base64')));
  }finally{globalThis.fetch=original;for(const key of Object.keys(env)){if(before[key]===undefined)delete process.env[key];else process.env[key]=before[key];}}
});
