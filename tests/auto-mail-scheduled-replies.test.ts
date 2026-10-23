import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import crypto from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {deliverOutbox} from '../server-handlers/auto-mail/outbox.js';
import {encryptMailboxToken} from '../server-handlers/auto-mail/token-encryption.js';
const actor='10000000-0000-4000-8000-000000000001',mailbox='10000000-0000-4000-8000-000000000002',version='10000000-0000-4000-8000-000000000003',id='10000000-0000-4000-8000-000000000004';
test('scheduled reply reservation is atomic, cancellation releases it, claiming blocks cancellation, and public roles cannot queue',async()=>{
 const db=new PGlite();try{
  await db.exec("create role anon;create role authenticated;create role service_role bypassrls;create schema storage;create table storage.buckets(id text,name text,public boolean,file_size_limit bigint);create table storage.objects(bucket_id text);alter table storage.objects enable row level security;");
  for(const name of ['20261022000000_foundation.sql','20261022010000_gmail_manual_replies.sql','20261022020000_knowledge_base.sql','20261022030000_ai_reply_drafts.sql','20261022040000_reviewed_learning.sql','20261022060000_rich_replies.sql','20261022070000_compose_outbox.sql','20261023000000_scheduled_replies.sql'])await db.exec(readFileSync(new URL('../supabase/auto-mail/migrations/'+name,import.meta.url),'utf8'));
  await db.query("insert into auto_mail.mailboxes(id,email) values($1,'support@example.com')",[mailbox]);
  await db.query("insert into auto_mail.gmail_connections(id,mailbox_id,google_subject,email,refresh_token_ciphertext,token_iv,token_auth_tag,scopes,connected_by,version) values('system',$1,'google','support@example.com','cipher','iv','tag','{}',$2,$3)",[mailbox,actor,version]);
  const delivery={id,mailbox_id:mailbox,connection_version:version,gmail_thread_id:'thread1',source_message_id:'m1',recipient:'customer@example.com',body_text:'Scheduled response',requested_by:actor,subject:'Re: Question'};
  const detail={to:['customer@example.com'],cc:[],bcc:[],html:'<p>Scheduled response</p>',attachments:[]};
  const job={raw_path:'prepared/reply',raw_sha256:'a'.repeat(64),send_at:new Date(Date.now()+600000).toISOString(),reply_context:{threadId:'thread1',sourceMessageId:'m1',recipient:'customer@example.com',actorId:actor}};
  const queue=()=>db.query('select auto_mail.queue_scheduled_reply($1,$2,$3)',[delivery,detail,job]);
  await db.exec('set role service_role');await queue();await queue();assert.equal((await db.query<any>('select count(*)::int as count from auto_mail.outbox_messages')).rows[0].count,1);
  await assert.rejects(()=>db.query('select auto_mail.claim_manual_reply($1)',[{...delivery,id:'20000000-0000-4000-8000-000000000004'}]),/unique|duplicate/);
  await db.query('select auto_mail.cancel_outbox_message($1,$2)',[id,mailbox]);assert.equal((await db.query<any>('select count(*)::int as count from auto_mail.reply_deliveries')).rows[0].count,0);
  delivery.id='20000000-0000-4000-8000-000000000004';job.raw_path='prepared/reply2';await queue();
  await db.exec('reset role');await db.query("update auto_mail.outbox_messages set send_at=now()-interval '1 minute' where id=$1",[delivery.id]);await db.exec('set role service_role');
  const claim=await db.query<any>('select auto_mail.claim_outbox_message($1) as job',[delivery.id]);assert.equal(claim.rows[0].job.reply_context.threadId,'thread1');
  await assert.rejects(()=>db.query('select auto_mail.cancel_outbox_message($1,$2)',[delivery.id,mailbox]),/OUTBOX_ALREADY_STARTED/);
  await db.query("select auto_mail.finish_outbox_message($1,'FAILED',null,null,'Source changed')",[delivery.id]);assert.equal((await db.query<any>('select count(*)::int as count from auto_mail.reply_deliveries')).rows[0].count,0,'A definite pre-send failure releases the reply reservation');
  assert.equal((await db.query<any>("select has_function_privilege('authenticated','auto_mail.queue_scheduled_reply(jsonb,jsonb,jsonb)','EXECUTE') as allowed")).rows[0].allowed,false);
 }finally{await db.close();}
});
test('scheduled reply worker sends in the original thread, saves a reply receipt, and refuses a stale source before sending',async()=>{
 const env={AUTO_MAIL_APP_URL:'http://localhost:3000',GOOGLE_OAUTH_CLIENT_ID:'test',GOOGLE_OAUTH_CLIENT_SECRET:'test',GOOGLE_TOKEN_ENCRYPTION_KEY:Buffer.alloc(32,1).toString('base64')};const before=Object.fromEntries(Object.keys(env).map(key=>[key,process.env[key]]));Object.assign(process.env,env);const original=globalThis.fetch;
 const bytes=Buffer.from('MIME threading snapshot');const job={id,actor_id:actor,mailbox_id:mailbox,connection_version:version,raw_path:'private',raw_sha256:crypto.createHash('sha256').update(bytes).digest('hex'),reply_context:{threadId:'thread1',sourceMessageId:'m1',recipient:'customer@example.com',actorId:actor}};
 const connection={mailbox_id:mailbox,version,email:'support@example.com',scopes:['https://www.googleapis.com/auth/gmail.send'],...encryptMailboxToken('refresh')};let sends=0,stale=false;const receipts:any[]=[];const finished:any[]=[];
 const client={from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:connection})})})}),storage:{from:()=>({download:async()=>({data:new Blob([bytes])})})},rpc:async(name:string,args:any)=>{if(name==='finish_manual_reply')receipts.push(args);if(name==='finish_outbox_message')finished.push(args);return{data:{learning_queued:false}};}};
 globalThis.fetch=(async(input:any,init:any={})=>{const url=String(input);if(url.includes('oauth2.googleapis.com'))return new Response('{"access_token":"token"}');if(url.includes('/threads/thread1'))return new Response(JSON.stringify({id:'thread1',messages:[{id:stale?'m2':'m1',labelIds:['INBOX'],payload:{headers:[{name:'From',value:'customer@example.com'},{name:'Subject',value:'Question'},{name:'Message-ID',value:'<m1@example.com>'}]}}]}));if(url.includes('/messages/send')){sends++;assert.equal(JSON.parse(init.body).threadId,'thread1');return new Response('{"id":"sent1","threadId":"thread1"}');}throw new Error('Unexpected URL');}) as typeof fetch;
 try{assert.equal((await deliverOutbox(client,job)).status,'SENT');assert.equal(sends,1);assert.equal(receipts[0].p_id,id);stale=true;assert.equal((await deliverOutbox(client,job)).status,'FAILED');assert.equal(sends,1);assert.equal(finished.at(-1).p_status,'FAILED');}finally{globalThis.fetch=original;for(const key of Object.keys(env)){if(before[key]===undefined)delete process.env[key];else process.env[key]=before[key];}}
});
