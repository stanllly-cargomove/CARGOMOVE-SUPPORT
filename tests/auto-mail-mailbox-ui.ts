// Offline integration: Gmail and storage are intercepted; no customer emails are sent.
import assert from 'node:assert/strict';
import { readFile, readdir, mkdir } from 'node:fs/promises';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

const bundle = await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {AutoMail} from './src/components/admin/AutoMail';createRoot(document.getElementById('root')).render(<main className="p-4"><AutoMail/></main>);`,loader:'tsx',resolveDir:process.cwd()},bundle:true,write:false,format:'iife',platform:'browser',define:{'process.env.NODE_ENV':'"test"'}});
const css = (await Promise.all((await readdir('dist/assets')).filter(file=>file.endsWith('.css')).map(file=>readFile('dist/assets/'+file,'utf8')))).join('\n');
await mkdir('test-results',{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
try {
  for(const width of [390,1440]) {
    const page=await browser.newPage({viewport:{width,height:1000}});
    const errors:string[]=[]; page.on('pageerror',error=>errors.push(error.message));
    const lists:URL[]=[];
    let composeSends=0,scheduled=false,cancelled=false,managed=0,connectionVersion='v1';
    await page.route('**/*',async route=>{
      const url=new URL(route.request().url());
      if(url.pathname==='/styles.css')return route.fulfill({contentType:'text/css',body:css});
      if(url.pathname.startsWith('/assets/'))return route.fulfill({path:'dist'+url.pathname});
      if(url.pathname==='/api/auto-mail/status')return route.fulfill({json:{state:'READY',mailboxConnected:true,oauthReady:true,mailbox:'support@example.com',richRepliesReady:true,composeReady:true,schedulerReady:true,canManageMail:true,connectionVersion}});
      if(url.pathname==='/api/auto-mail/mailbox-action'){managed++;const body=route.request().postDataJSON();assert.equal(body.connectionVersion,'v1');assert.ok(['trash','restore'].includes(body.action));return route.fulfill({json:{completed:body.ids,failed:[]}});}
      if(url.pathname==='/api/auto-mail/compose'){const body=route.request().postDataJSON();assert.equal(body.to,'newcustomer@example.com');assert.equal(body.subject,'New registration');assert.match(body.bodyHtml,/New instructions/);assert.equal(body.connectionVersion,'v1');assert.ok(body.requestId);assert.deepEqual(body.attachmentIds,[]);if(body.sendAt){scheduled=true;assert.ok(Date.parse(body.sendAt)>Date.now());return route.fulfill({json:{status:'QUEUED'}});}composeSends++;return route.fulfill({json:{status:'SENT'}});}
      if(url.pathname==='/api/auto-mail/outbox')return route.fulfill({json:{messages:scheduled?[{id:'job1',subject:'New registration',to_addresses:['newcustomer@example.com'],cc_addresses:[],bcc_addresses:[],attachments:[],send_at:new Date(Date.now()+600000).toISOString(),status:cancelled?'CANCELLED':'QUEUED',error:''}]:[],nextOffset:null,workerReady:true}});
      if(url.pathname==='/api/auto-mail/outbox-cancel'){cancelled=true;return route.fulfill({json:{status:'CANCELLED'}});}
      if(url.pathname==='/api/auto-mail/threads') {
        lists.push(url);
        const sent=url.searchParams.get('folder')==='sent'; const search=url.searchParams.get('q'); const more=url.searchParams.has('pageToken');
        return route.fulfill({json:{threads:search==='nothing'?[]:[{id:more?'thread2':'thread1',subject:more?'Second page':sent?'Sent registration instructions':'Registration help',from:'Customer <customer@example.com>',to:'customer@example.com',snippet:'Please review the registration documents.',unread:!sent,timestamp:Date.now(),messageCount:2}],nextPageToken:!more&&!search?'next-page':null}});
      }
      if(url.pathname==='/api/auto-mail/thread')return route.fulfill({json:{id:'thread1',subject:'Registration help',recipient:'customer@example.com',mailbox:'support@example.com',connectionVersion:'v1',replyBlocked:'',messages:[{id:'m1',from:'customer@example.com',to:'support@example.com',body:'Please help with registration.',date:'2026-10-22',outbound:false,attachments:false}]}});
      assert.ok(!url.pathname.startsWith('/api/'),'Unexpected API request: '+url.pathname);
      return route.fulfill({contentType:'text/html',body:`<meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css"><div id="root"></div><script>${bundle.outputFiles[0].text}</script>`});
    });
    await page.goto('http://localhost:3000/');
    const folders=page.getByRole('navigation',{name:'Mail folders'});
    await page.getByRole('button',{name:/Customer.*Registration help/}).waitFor();
    await page.getByRole('checkbox',{name:'Select Registration help',exact:true}).check();
    await page.getByText('1 selected',{exact:true}).waitFor();
    await page.getByRole('button',{name:'Show selected',exact:true}).click();
    await page.getByRole('button',{name:'Open selected',exact:true}).click();
    const editor=page.getByRole('textbox',{name:'Your reply',exact:true}); await editor.fill('Unsent draft');
    await page.getByRole('button',{name:'Back to Inbox',exact:true}).click();
    await page.getByRole('button',{name:/Customer.*Registration help/}).click();
    assert.match(await editor.innerText(),/Unsent draft/,'Back and reopening preserves rich draft');
    page.once('dialog',dialog=>dialog.dismiss()); await folders.getByRole('button',{name:'Sent',exact:true}).click();
    assert.match(await editor.innerText(),/Unsent draft/,'Cancelled folder switch preserves draft');
    page.once('dialog',dialog=>dialog.accept()); await folders.getByRole('button',{name:'Sent',exact:true}).click();
    await page.getByRole('button',{name:/To:.*Sent registration instructions/}).waitFor();
    assert.equal(await page.getByRole('checkbox',{name:'Select all loaded conversations'}).isChecked(),false);
    const search=page.getByRole('searchbox',{name:'Search emails'});
    await search.fill('has:attachment'); await Promise.all([page.waitForResponse(response=>new URL(response.url()).searchParams.get('q')==='has:attachment'),search.press('Enter')]);
    await page.getByText('Sent · Results for “has:attachment”',{exact:true}).waitFor();
    assert.equal(lists.at(-1)!.searchParams.get('folder'),'sent');assert.equal(lists.at(-1)!.searchParams.get('q'),'has:attachment');
    await page.getByRole('button',{name:'Clear email search'}).click();
    await page.getByRole('button',{name:'Load more',exact:true}).click();
    await page.getByRole('button',{name:/Second page/}).waitFor();
    assert.equal(lists.at(-1)!.searchParams.get('folder'),'sent');assert.equal(lists.at(-1)!.searchParams.get('pageToken'),'next-page');
    await page.getByRole('checkbox',{name:'Select all loaded conversations'}).check();
    await page.getByText('2 selected',{exact:true}).waitFor();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'No page overflow');
    await page.screenshot({path:`test-results/auto-mail-mailbox-${width}.png`,fullPage:true});
    await search.fill('nothing');await search.press('Enter');await page.getByText('No conversations match this search.',{exact:true}).waitFor();
    await folders.getByRole('button',{name:'Inbox',exact:true}).click();
    await page.getByRole('button',{name:/Customer.*Registration help/}).waitFor();
    assert.equal(await page.getByRole('searchbox',{name:'Search emails'}).inputValue(),'');
    const mailboxBox=page.locator('nav[aria-label="Mail folders"]').locator('..').locator('..');
    const listHeight=(await mailboxBox.boundingBox())!.height;
    await page.getByRole('button',{name:/Customer.*Registration help/}).click();
    await page.getByRole('textbox',{name:'Your reply',exact:true}).waitFor();
    assert.equal(await page.getByRole('search',{name:'Search mail'}).count(),0,'Reader hides the search header');
    assert.equal((await mailboxBox.boundingBox())!.height,listHeight,'Reader keeps the mailbox height');
    page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'Move conversation to Trash',exact:true}).click();
    await page.getByText('1 conversation(s) moved to Trash.',{exact:true}).waitFor();
    await folders.getByRole('button',{name:'Trash',exact:true}).click();
    await page.getByRole('checkbox',{name:'Select Registration help',exact:true}).check();
    page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'Restore selected',exact:true}).click();
    await page.getByText('1 conversation(s) restored.',{exact:true}).waitFor();assert.equal(managed,2);
    const compose=async()=>{await folders.getByRole('button',{name:'Compose',exact:true}).click();await page.getByRole('textbox',{name:'Reply To recipients',exact:true}).fill('newcustomer@example.com');await page.getByRole('textbox',{name:'Message subject',exact:true}).fill('New registration');await page.getByRole('textbox',{name:'Your reply',exact:true}).fill('New instructions');};
    await compose();await page.getByRole('button',{name:'Send message',exact:true}).click();
    await page.getByText('Message sent through Gmail.',{exact:true}).waitFor();assert.equal(composeSends,1);
    await compose();
    const local=await page.evaluate(()=>{const date=new Date(Date.now()+600000);return new Date(date.getTime()-date.getTimezoneOffset()*60000).toISOString().slice(0,16);});
    await page.getByLabel('Scheduled send time',{exact:true}).fill(local);
    await page.getByRole('button',{name:'Schedule send',exact:true}).click();
    await page.getByText('Message scheduled. View or cancel it in Scheduled.',{exact:true}).waitFor();assert.equal(composeSends,1,'Scheduling never sends immediately');
    await folders.getByRole('button',{name:'Scheduled',exact:true}).click();
    await page.getByRole('button',{name:'Cancel scheduled message',exact:true}).waitFor();
    await page.screenshot({path:`test-results/auto-mail-scheduled-${width}.png`,fullPage:true});
    page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'Cancel scheduled message',exact:true}).click();
    await page.getByText(/· CANCELLED/).waitFor();assert.equal(cancelled,true);
    await compose();connectionVersion='v2';await page.getByRole('button',{name:/Click to refresh inbox/}).click();
    await page.getByText('The Gmail connection changed. Close this composer and open a new message before sending.',{exact:true}).waitFor();
    assert.equal(await page.getByRole('button',{name:'Send message',exact:true}).isDisabled(),true);
    assert.match(await page.getByRole('textbox',{name:'Your reply',exact:true}).innerText(),/New instructions/,'Changing connection keeps content but blocks sending');
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'Extended mailbox has no page overflow');
    assert.deepEqual(errors,[]);await page.close();
  }
  console.log('Mailbox: Inbox/Sent, Gmail search/pagination, selection, draft-preserving navigation and mobile layout passed.');
} finally { await browser.close(); }
