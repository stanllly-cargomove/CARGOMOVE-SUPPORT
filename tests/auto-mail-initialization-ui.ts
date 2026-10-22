// Offline browser coverage: no live Gmail calls or customer data.
import assert from 'node:assert/strict';
import { readFile, readdir, mkdir } from 'node:fs/promises';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

const bundle=await build({stdin:{contents:`import React,{useState} from 'react';import{createRoot}from'react-dom/client';import{AutoMail}from'./src/components/admin/AutoMail';import{clearMailSession}from'./src/services/autoMailCache';function App(){const[show,setShow]=useState(true);const[user,setUser]=useState('admin1');return <><div><button onClick={()=>setShow(x=>!x)}>{show?'Other page':'Open Auto Mail'}</button><button onClick={()=>{clearMailSession();setShow(false);}}>Log out</button><button onClick={()=>setUser('admin2')}>Switch user</button></div>{show&&<AutoMail key={user} cacheScope={user}/>}</>}createRoot(document.getElementById('root')).render(<App/>);`,loader:'tsx',resolveDir:process.cwd()},bundle:true,write:false,format:'iife',platform:'browser',define:{'process.env.NODE_ENV':'"test"'}});
const css=(await Promise.all((await readdir('dist/assets')).filter(file=>file.endsWith('.css')).map(file=>readFile('dist/assets/'+file,'utf8')))).join('\n');
await mkdir('test-results',{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
const deferred=()=>{let resolve!:()=>void;const promise=new Promise<void>(done=>resolve=done);return {promise,resolve};};
try {
  for(const width of [390,1440]) {
    const page=await browser.newPage({viewport:{width,height:1000}});
    const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
    let statusGate=deferred();const inboxGate=deferred(),sentGate=deferred(),scheduleGate=deferred();
    let version='v1',failScheduled=false,statuses=0,scheduled=0;const lists:URL[]=[];
    await page.route('**/*',async route=>{
      const url=new URL(route.request().url());
      if(url.pathname==='/styles.css')return route.fulfill({contentType:'text/css',body:css});
      if(url.pathname.startsWith('/assets/'))return route.fulfill({path:'dist'+url.pathname});
      if(url.pathname==='/api/auto-mail/status'){statuses++;await statusGate.promise;return route.fulfill({json:{state:'READY',mailboxConnected:true,oauthReady:true,mailbox:'support@example.com',connectionVersion:version,composeReady:true,richRepliesReady:true,schedulerReady:true,canManageMail:true}});}
      if(url.pathname==='/api/auto-mail/threads') {
        lists.push(url);await (url.searchParams.get('folder')==='sent'?sentGate:inboxGate).promise;
        const more=url.searchParams.has('pageToken');const sent=url.searchParams.get('folder')==='sent';
        return route.fulfill({json:{threads:[{id:more?'second':'first',subject:more?'Older loaded email':sent?'Sent email':version==='v1'?'Cached inbox email':'New mailbox email',from:'Customer <customer@example.com>',to:'customer@example.com',snippet:'Stored mail',unread:false,timestamp:Date.now()}],nextPageToken:more?null:'page2'}});
      }
      if(url.pathname==='/api/auto-mail/outbox'){scheduled++;await scheduleGate.promise;return route.fulfill(failScheduled?{status:503,json:{error:'Scheduled is temporarily unavailable.'}}:{json:{messages:[],nextOffset:null,workerReady:true}});}
      assert.ok(!url.pathname.startsWith('/api/'),'Unexpected API '+url.pathname);
      return route.fulfill({contentType:'text/html',body:`<meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css"><div id="root"></div><script>${bundle.outputFiles[0].text}</script>`});
    });
    await page.goto('http://localhost:3000/');
    const loader=page.getByRole('region',{name:'Initializing Auto Mail',exact:true});
    const progress=page.getByRole('progressbar',{name:'Mailbox initialization progress'});
    const expectProgress=async(value:number)=>page.waitForFunction(value=>document.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')===String(value),value);
    await loader.waitFor();assert.equal(await progress.getAttribute('aria-valuenow'),'0');
    statusGate.resolve();await expectProgress(25);
    inboxGate.resolve();await expectProgress(50);
    sentGate.resolve();await expectProgress(75);
    await page.screenshot({path:`test-results/auto-mail-initialization-progress-${width}.png`,fullPage:true});
    scheduleGate.resolve();await page.getByRole('button',{name:/Cached inbox email/}).waitFor();assert.equal(await loader.count(),0);
    assert.equal(lists.length,2);assert.equal(scheduled,1);
    const folders=page.getByRole('navigation',{name:'Mail folders'});
    await folders.getByRole('button',{name:'Sent',exact:true}).click();await page.getByRole('button',{name:/Sent email/}).waitFor();
    await folders.getByRole('button',{name:'Scheduled',exact:true}).click();await page.getByText('No scheduled messages yet.',{exact:false}).waitFor();
    assert.equal(lists.length,2);assert.equal(scheduled,1,'Prefetched Scheduled does not load again');
    await folders.getByRole('button',{name:'Inbox',exact:true}).click();await page.getByRole('button',{name:/Cached inbox email/}).waitFor();
    await page.getByRole('button',{name:'Load more',exact:true}).click();await page.getByRole('button',{name:/Older loaded email/}).waitFor();
    await page.getByRole('button',{name:'Other page',exact:true}).click();await page.getByRole('button',{name:'Open Auto Mail',exact:true}).click();
    await page.getByRole('button',{name:/Older loaded email/}).waitFor();assert.equal(await loader.count(),0);
    assert.equal(statuses,1);assert.equal(lists.length,3);
    // Hold background validation on reload: both previously loaded pages must render first.
    statusGate=deferred();await page.reload();
    await page.getByRole('button',{name:/Older loaded email/}).waitFor();assert.equal(await loader.count(),0);
    const refreshed=page.waitForResponse(response=>response.url().includes('/threads?')&&new URL(response.url()).searchParams.has('pageToken'));
    statusGate.resolve();await refreshed;await page.getByRole('button',{name:/Older loaded email/}).waitFor();
    assert.equal(scheduled,1,'Browser reload does not repeat initialization');
    // A fresh administrator never sees another administrator's cached rows.
    statusGate=deferred();await page.getByRole('button',{name:'Switch user',exact:true}).click();await loader.waitFor();
    assert.equal(await page.getByRole('button',{name:/Cached inbox email/}).count(),0);
    statusGate.resolve();await page.getByRole('button',{name:/Cached inbox email/}).waitFor();
    // A changed Gmail connection requires a new initialization, with old mail hidden.
    statusGate=deferred();version='v2';await page.reload();await page.getByRole('button',{name:/Cached inbox email/}).waitFor();
    statusGate.resolve();await page.getByRole('button',{name:/New mailbox email/}).waitFor();assert.equal(await page.getByRole('button',{name:/Cached inbox email/}).count(),0);
    // Clear persisted snapshots and exercise partial failure + retry using the successful folder caches.
    await page.getByRole('button',{name:'Log out',exact:true}).click();
    assert.equal(await page.evaluate(()=>sessionStorage.getItem('cargomove.auto-mail.v1')),null);
    failScheduled=true;await page.getByRole('button',{name:'Open Auto Mail',exact:true}).click();
    await page.getByRole('alert').filter({hasText:'Scheduled is temporarily unavailable.'}).waitFor();
    assert.equal(await progress.getAttribute('aria-valuenow'),'75');const beforeRetry=lists.length;
    failScheduled=false;await page.getByRole('button',{name:'Retry initialization',exact:true}).click();await page.getByRole('button',{name:/New mailbox email/}).waitFor();
    assert.equal(lists.length,beforeRetry,'Retry reuses successfully loaded folders');
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    assert.deepEqual(errors,[]);await page.close();
  }
  console.log('Initialization progress, folder prefetch, navigation/reload persistence, pagination, user/connection isolation, logout and retry passed on mobile/desktop.');
} finally {await browser.close();}
