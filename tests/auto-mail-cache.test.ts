import test from 'node:test';
import assert from 'node:assert/strict';
import { cachedMail, peekMail, clearMailSession, expireMail, MAIL_REFRESH_MS } from '../src/services/autoMailCache.js';
import { startMailSend, mailSendSnapshot, type ComposeDraft } from '../src/services/autoMailSending.js';

test('mail cache reuses requests for 120 seconds, deduplicates, isolates users/connections and handles unchanged history',async()=>{
  clearMailSession();const original=globalThis.fetch;const now=Date.now;let time=1000000,calls=0;const urls:string[]=[];
  Date.now=()=>time;
  globalThis.fetch=(async(input:any)=>{calls++;urls.push(String(input));return new Response(JSON.stringify(String(input).includes('historyId=')?{notModified:true,historyId:'42'}:{threads:[{id:'thread1'}],historyId:'42'}));}) as typeof fetch;
  try {
    await Promise.all([cachedMail('admin1','threads?folder=inbox',{context:'v1'}),cachedMail('admin1','threads?folder=inbox',{context:'v1'})]);assert.equal(calls,1);
    time+=MAIL_REFRESH_MS-1;await cachedMail('admin1','threads?folder=inbox',{context:'v1'});assert.equal(calls,1);
    time+=2;const result=await cachedMail<any>('admin1','threads?folder=inbox',{context:'v1'});assert.deepEqual(result.threads,[{id:'thread1'}]);assert.match(urls.at(-1)!,/historyId=42/);assert.equal(calls,2);
    await cachedMail('admin1','threads?folder=inbox',{context:'v1',force:true});assert.ok(!urls.at(-1)!.includes('historyId='),'Manual refresh fetches actual rows');
    await cachedMail('admin1','threads?folder=inbox',{context:'v2'});await cachedMail('admin2','threads?folder=inbox',{context:'v1'});assert.equal(calls,5);
    expireMail('admin1','threads');await cachedMail('admin1','threads?folder=inbox',{context:'v1'});assert.equal(calls,6);
    clearMailSession();assert.equal(peekMail('admin1','threads?folder=inbox','v1'),undefined);
    let resolve!:(response:Response)=>void;globalThis.fetch=(()=>new Promise<Response>(done=>resolve=done)) as typeof fetch;
    const stale=cachedMail('admin1','status');clearMailSession();resolve(new Response('{"mailbox":"private"}'));await stale;
    assert.equal(peekMail('admin1','status'),undefined,'An in-flight request cannot refill a signed-out session');
  }finally{Date.now=now;globalThis.fetch=original;clearMailSession();}
});

test('background send survives view changes, keeps failed drafts and prevents automatic retries after uncertain outcomes',async()=>{
  clearMailSession();const original=globalThis.fetch;let done!:(value:Response)=>void;let calls=0;
  globalThis.fetch=(()=>{calls++;return new Promise<Response>(resolve=>done=resolve);}) as typeof fetch;
  const draft:ComposeDraft={requestId:'request1',connectionVersion:'v1',mailbox:'support@example.com',subject:'Test',body:'Hello',bodyHtml:'<p>Hello</p>',to:'customer@example.com',cc:'',bcc:'',attachmentIds:[],files:[]};
  const settle=()=>new Promise(resolve=>setTimeout(resolve,10));
  try {
    startMailSend('admin',draft);assert.equal(mailSendSnapshot()[0].state,'SENDING');startMailSend('admin',draft);assert.equal(calls,1);
    done(new Response('{"status":"SENT"}'));await settle();assert.equal(mailSendSnapshot()[0].state,'SENT');
    startMailSend('admin',{...draft,requestId:'request2'});done(new Response('{"status":"UNCERTAIN"}'));await settle();
    assert.equal(mailSendSnapshot()[0].state,'ERROR');assert.equal(mailSendSnapshot()[0].draft.body,'Hello');assert.equal(mailSendSnapshot()[0].canEdit,false);
    startMailSend('admin',{...draft,requestId:'request2'});assert.equal(calls,2,'Uncertain sends never retry');
    startMailSend('admin',{...draft,requestId:'request3'});done(new Response('{"error":"Invalid CC","canEditReply":true}',{status:400}));await settle();
    const failed=mailSendSnapshot().find(task=>task.id==='request3')!;assert.equal(failed.canEdit,true);assert.equal(failed.draft.requestId,'request3');
    startMailSend('admin',{...draft,requestId:'request4'});clearMailSession();done(new Response('{"status":"SENT"}'));await settle();assert.deepEqual(mailSendSnapshot(),[]);
  }finally{globalThis.fetch=original;clearMailSession();}
});
