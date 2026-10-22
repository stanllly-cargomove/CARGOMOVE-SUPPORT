import test from 'node:test';
import assert from 'node:assert/strict';
import { cachedMail, peekMail, clearMailSession, expireMail, writeMail, refreshMailThreads, MAIL_REFRESH_MS } from '../src/services/autoMailCache.js';
import { initializeMail, mailInitialized } from '../src/services/autoMailInitialization.js';
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


test('initialization shares requests, reports completed folders, isolates connections and retries only failed folders',async()=>{
  clearMailSession();const original=globalThis.fetch;const calls:string[]=[];let fail=true;
  const status={state:'READY',mailboxConnected:true,oauthReady:true,mailbox:'support@example.com',connectionVersion:'v1',composeReady:true};
  globalThis.fetch=(async(input:any)=>{const path=new URL(String(input),'http://test').pathname+new URL(String(input),'http://test').search;calls.push(path);if(path.endsWith('/status'))return new Response(JSON.stringify(status));if(path.includes('/outbox'))return new Response(JSON.stringify(fail?{error:'Scheduled offline'}:{messages:[],nextOffset:null,workerReady:true}),{status:fail?503:200});return new Response(JSON.stringify({threads:[],nextPageToken:null}));}) as typeof fetch;
  const progress:number[]=[];
  try {
    const pending=[initializeMail('admin',p=>progress.push(p.completed)),initializeMail('admin',()=>{})];
    const result=await Promise.allSettled(pending);assert.ok(result.every(item=>item.status==='rejected'));
    assert.equal(mailInitialized('admin'),false);assert.equal(calls.length,4);assert.ok(progress.includes(3));
    fail=false;await initializeMail('admin',()=>{});assert.equal(calls.length,5,'Only the failed folder is retried');assert.equal(mailInitialized('admin'),true);
    await initializeMail('admin',()=>{});assert.equal(calls.length,5,'Navigation never repeats the initialization');
    assert.equal(mailInitialized('another-admin'),false);
    writeMail('admin','status',{...status,connectionVersion:'v2'});assert.equal(mailInitialized('admin'),false);
    await initializeMail('admin',()=>{});assert.equal(calls.length,8,'A new Gmail connection has separate folder data');
    assert.equal(mailInitialized('admin'),true);
  }finally{globalThis.fetch=original;clearMailSession();}
});

test('logout cancels initialization and prevents it from persisting a completed marker',async()=>{
  clearMailSession();const original=globalThis.fetch;let resolve!:(value:Response)=>void;let calls=0;
  globalThis.fetch=(()=>{calls++;return new Promise<Response>(done=>resolve=done);}) as typeof fetch;
  try {
    const job=initializeMail('admin',()=>{});clearMailSession();
    resolve(new Response(JSON.stringify({state:'READY',mailboxConnected:true,oauthReady:true,connectionVersion:'v1',composeReady:true})));
    await assert.rejects(job,/session ended/);assert.equal(calls,1);assert.equal(mailInitialized('admin'),false);assert.equal(peekMail('admin','status'),undefined);
  }finally{globalThis.fetch=original;clearMailSession();}
});

test('refresh keeps the loaded page count and cannot repopulate the cache after logout',async()=>{
  clearMailSession();const original=globalThis.fetch;const calls:string[]=[];
  writeMail('admin','threads?folder=inbox',{threads:[{id:'old1'},{id:'old2'}],nextPageToken:null},'v1');
  globalThis.fetch=(async(input:any)=>{const url=String(input);calls.push(url);return new Response(JSON.stringify({threads:[{id:url.includes('pageToken')?'new2':'new1'}],nextPageToken:url.includes('pageToken')?null:'page2'}));}) as typeof fetch;
  try {
    const updated=await refreshMailThreads('admin','threads?folder=inbox','v1');assert.deepEqual(updated.threads,[{id:'new1'},{id:'new2'}]);assert.equal(calls.length,2);
    let resolve!:(value:Response)=>void;globalThis.fetch=(()=>new Promise<Response>(done=>resolve=done)) as typeof fetch;
    const job=refreshMailThreads('admin','threads?folder=inbox','v1');clearMailSession();resolve(new Response('{"threads":[],"nextPageToken":null}'));
    await assert.rejects(job,/session ended/);assert.equal(peekMail('admin','threads?folder=inbox','v1'),undefined);
  }finally{globalThis.fetch=original;clearMailSession();}
});


test('cache eviction preserves initialization across many opened messages, and blocked storage falls back to memory',async()=>{
  clearMailSession();const descriptor=Object.getOwnPropertyDescriptor(globalThis,'sessionStorage');
  Object.defineProperty(globalThis,'sessionStorage',{configurable:true,get(){throw new Error('Storage blocked');}});
  try {
    writeMail('admin','status',{state:'READY',mailboxConnected:true,connectionVersion:'v1'});
    writeMail('admin','initialized',{ready:true},'v1');
    for(let i=0;i<100;i++)writeMail('admin',`thread?id=${i}`,{id:String(i)},'v1');
    assert.equal(mailInitialized('admin'),true,'Opening many messages does not restart initialization');
    assert.equal(peekMail('admin','thread?id=99','v1')!==undefined,true);
    clearMailSession();assert.equal(mailInitialized('admin'),false);
  }finally{if(descriptor)Object.defineProperty(globalThis,'sessionStorage',descriptor);else Reflect.deleteProperty(globalThis,'sessionStorage');clearMailSession();}
});
