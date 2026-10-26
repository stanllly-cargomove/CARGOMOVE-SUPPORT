// All APIs are intercepted. No live database, Gmail or model access.
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

const bundle = await build({stdin:{contents:`import React from 'react';import{createRoot}from'react-dom/client';import{AutoMail}from'./src/components/admin/AutoMail';createRoot(document.getElementById('root')).render(<AutoMail cacheScope="inbox-state"/>);`,loader:'tsx',resolveDir:process.cwd()},bundle:true,write:false,format:'iife',platform:'browser',define:{'process.env.NODE_ENV':'"test"'}});
const css = (await Promise.all((await readdir('dist/assets')).filter(file=>file.endsWith('.css')).map(file=>readFile('dist/assets/'+file,'utf8')))).join('\n');
const browser = await chromium.launch({channel:'chrome',headless:true});
try {
  for (const width of [390,1440]) {
    const page = await browser.newPage({viewport:{width,height:1000}});
    await page.clock.install();
    const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
    let history=1;
    await page.route('**/*',route=>{
      const url=new URL(route.request().url());
      if(url.pathname==='/styles.css')return route.fulfill({contentType:'text/css',body:css});
      if(url.pathname==='/api/auto-mail/status')return route.fulfill({json:{state:'READY',mailboxConnected:true,oauthReady:true,mailbox:'support@example.com',connectionVersion:'v1',knowledgeReady:true}});
      if(url.pathname==='/api/auto-mail/knowledge')return route.fulfill({json:{articles:[],total:0}});
      if(url.pathname==='/api/auto-mail/threads'){
        if(url.searchParams.get('historyId')===String(history))return route.fulfill({json:{notModified:true}});
        const offset=Number(url.searchParams.get('pageToken')||0);
        const threads=Array.from({length:25},(_,i)=>({id:`thread${offset+i}`,subject:`Question ${offset+i} revision ${history}`,from:'customer@example.com',snippet:'Registration question',unread:false}));
        return route.fulfill({json:{threads,nextPageToken:offset<50?String(offset+25):null,historyId:String(history)}});
      }
      if(url.pathname==='/api/auto-mail/thread'){const id=url.searchParams.get('id')||'';return route.fulfill({json:{id,subject:`Question ${id.replace('thread','')} revision ${history}`,recipient:'customer@example.com',mailbox:'support@example.com',connectionVersion:'v1',replyBlocked:'',messages:[{id:`message-${id}`,from:'customer@example.com',to:'support@example.com',date:new Date().toISOString(),body:'Registration question',outbound:false,attachments:false}]}});}
      assert.ok(!url.pathname.startsWith('/api/'),'Unexpected API '+url.pathname);
      return route.fulfill({contentType:'text/html',body:`<meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css"><div id="root"></div><script>${bundle.outputFiles[0].text}</script>`});
    });
    const rows=()=>page.getByRole('checkbox',{name:/^Select Question/});
    const count=async(n:number)=>{await page.waitForFunction(n=>document.querySelectorAll('input[aria-label^="Select Question"]').length===n,n);assert.equal(await rows().count(),n);};
    const folders=page.getByRole('navigation',{name:'Mail folders'});
    await page.goto('http://localhost:3000/');await count(25);
    await page.getByRole('button',{name:'Load more',exact:true}).click();await count(50);
    await folders.getByRole('button',{name:'Knowledge Base',exact:true}).click();
    await page.getByRole('heading',{name:'Knowledge base',exact:true}).waitFor();
    await folders.getByRole('button',{name:'Inbox',exact:true}).click();await count(50);
    // Expire the inbox cache while KB is open, then change Gmail's history.
    await folders.getByRole('button',{name:'Knowledge Base',exact:true}).click();
    await page.getByRole('heading',{name:'Knowledge base',exact:true}).waitFor();
    await page.clock.runFor(121000);history++;
    await folders.getByRole('button',{name:'Inbox',exact:true}).click();
    await page.getByRole('button',{name:/Question 49 revision 2/}).waitFor();await count(50);
    history++;
    await page.getByRole('button',{name:/Click to refresh inbox/}).click();
    await page.getByRole('button',{name:/Question 49 revision 3/}).waitFor();await count(50);
    history++;await page.clock.runFor(120000);
    await page.getByRole('button',{name:/Question 49 revision 4/}).waitFor();await count(50);
    history++;await page.reload();
    await page.getByRole('button',{name:/Question 49 revision 5/}).waitFor();await count(50);
    await page.getByRole('button',{name:'Load more',exact:true}).click();await count(75);
    assert.deepEqual(errors,[]);await page.close();
  }
  console.log('25 → 50 inbox rows survive KB navigation, stale cache, manual/poll refresh and reload; pagination continues to 75 on mobile/desktop.');
} finally {await browser.close();}
