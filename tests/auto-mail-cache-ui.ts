// No actual Gmail or AI traffic. Browser time is advanced to verify the polling interval.
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

const bundle=await build({stdin:{contents:`import React,{useState} from 'react';import{createRoot}from'react-dom/client';import{AutoMail}from'./src/components/admin/AutoMail';function App(){const[show,setShow]=useState(true);return <main className="p-4"><button onClick={()=>setShow(x=>!x)}>{show?'Other menu':'Open Auto Mail'}</button>{show&&<AutoMail cacheScope="admin1"/>}</main>}createRoot(document.getElementById('root')).render(<App/>);`,loader:'tsx',resolveDir:process.cwd()},bundle:true,write:false,format:'iife',platform:'browser',define:{'process.env.NODE_ENV':'"test"'}});
const css=(await Promise.all((await readdir('dist/assets')).filter(file=>file.endsWith('.css')).map(file=>readFile('dist/assets/'+file,'utf8')))).join('\n');
const browser=await chromium.launch({channel:'chrome',headless:true});
try {
  for(const width of [390,1440]){
    const page=await browser.newPage({viewport:{width,height:1000}});await page.clock.install();
    let statuses=0,threadReads=0,lists=0,history='41',checks=0,sends=0;
    let release!:(value?:unknown)=>void;let gate=new Promise(resolve=>release=resolve);let fail=true;
    const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
    await page.route('**/*',async route=>{
      const url=new URL(route.request().url());
      if(url.pathname==='/styles.css')return route.fulfill({contentType:'text/css',body:css});
      if(url.pathname.startsWith('/assets/'))return route.fulfill({path:'dist'+url.pathname});
      if(url.pathname==='/api/auto-mail/status'){statuses++;return route.fulfill({json:{state:'READY',mailboxConnected:true,oauthReady:true,mailbox:'support@example.com',connectionVersion:'v1',composeReady:true,richRepliesReady:true,canManageMail:false}});}
      if(url.pathname==='/api/auto-mail/threads'){
        lists++;if(url.searchParams.has('historyId'))checks++;
        if(url.searchParams.get('historyId')===history)return route.fulfill({json:{notModified:true,historyId:history}});
        return route.fulfill({json:{threads:[{id:'thread1',subject:history==='41'?'Customer question':'New customer question',from:'Customer <customer@example.com>',snippet:'Please help.',unread:true}],nextPageToken:null,historyId:history}});
      }
      if(url.pathname==='/api/auto-mail/thread'){threadReads++;return route.fulfill({json:{id:'thread1',subject:'Customer question',recipient:'customer@example.com',mailbox:'support@example.com',connectionVersion:'v1',replyBlocked:'',messages:[{id:'m1',from:'customer@example.com',to:'support@example.com',body:'Please help.',date:'2026-10-22',outbound:false,attachments:false}]}});}
      if(url.pathname==='/api/auto-mail/compose'){sends++;await gate;return route.fulfill(fail?{status:400,json:{error:'Check the CC addresses.',canEditReply:true}}:{json:{status:'SENT'}});}
      assert.ok(!url.pathname.startsWith('/api/'),'Unexpected API '+url.pathname);
      return route.fulfill({contentType:'text/html',body:`<meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css"><div id="root"></div><script>${bundle.outputFiles[0].text}</script>`});
    });
    await page.goto('http://localhost:3000/');const row=()=>page.getByRole('button',{name:/Customer.*customer question/i});await row().waitFor();
    const folders=page.getByRole('navigation',{name:'Mail folders'});
    await folders.getByRole('button',{name:'Sent',exact:true}).click();await row().waitFor();
    await folders.getByRole('button',{name:'Inbox',exact:true}).click();await row().waitFor();assert.equal(lists,2);assert.equal(statuses,1,'Folder navigation reuses readiness');
    await row().click();await page.getByRole('textbox',{name:'Your reply',exact:true}).waitFor();
    await page.getByRole('button',{name:'Move conversation to Trash',exact:true}).click();
    await page.getByRole('button',{name:'Reconnect Gmail for Trash',exact:true}).waitFor();assert.equal(sends,0,'Permission guidance never sends or trashes mail');
    await page.getByRole('button',{name:'Other menu',exact:true}).click();await page.getByRole('button',{name:'Open Auto Mail',exact:true}).click();await row().click();await page.getByRole('textbox',{name:'Your reply',exact:true}).waitFor();assert.equal(threadReads,1,'Conversation cache survives menu changes');assert.equal(lists,2);
    await page.getByRole('button',{name:'Back to Inbox',exact:true}).click();
    await page.clock.runFor(119000);assert.equal(lists,2,'No repeated requests before the interval');
    const checked=page.waitForResponse(response=>response.url().includes('/threads?')&&response.url().includes('historyId=41'));await page.clock.runFor(1100);await checked;
    assert.equal(checks,1);assert.equal(lists,3);await row().waitFor();
    history='42';await page.clock.runFor(120000);await page.getByRole('button',{name:/New customer question/}).waitFor();assert.equal(checks,2);
    await folders.getByRole('button',{name:'Compose',exact:true}).click();await page.getByRole('textbox',{name:'Reply To recipients',exact:true}).fill('customer@example.com');await page.getByRole('textbox',{name:'Message subject',exact:true}).fill('Background test');await page.getByRole('textbox',{name:'Your reply',exact:true}).fill('Keep this draft');
    await page.getByRole('button',{name:'Send message',exact:true}).click();
    assert.equal(await page.getByRole('region',{name:'Compose email'}).count(),0,'Composer closes before the server response');
    await folders.getByRole('button',{name:'Sent',exact:true}).click();await row().waitFor();
    await page.getByRole('button',{name:'Other menu',exact:true}).click();release();await page.getByRole('button',{name:'Open Auto Mail',exact:true}).click();
    await page.getByRole('button',{name:'Restore draft',exact:true}).click();assert.match(await page.getByRole('textbox',{name:'Your reply',exact:true}).innerText(),/Keep this draft/);assert.equal(sends,1);
    fail=false;gate=new Promise(resolve=>release=resolve);await page.getByRole('button',{name:'Send message',exact:true}).click();release();
    await page.getByText('Message sent through Gmail.',{exact:true}).waitFor();assert.equal(sends,2);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.deepEqual(errors,[]);await page.close();
  }
  console.log('Cached navigation/conversations, 120-second conditional updates, Trash permission guidance and recoverable background sending passed on mobile/desktop.');
} finally {await browser.close();}
