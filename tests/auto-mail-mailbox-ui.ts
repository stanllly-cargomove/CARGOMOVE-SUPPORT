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
    let releaseStatus!:()=>void;const statusGate=new Promise<void>(resolve=>releaseStatus=resolve);
    const readChanges:string[]=[];
    let gmailUnread=true,failUnread=false;
    let composeSends=0,scheduled=false,cancelled=false,managed=0,connectionVersion='v1';
    await page.route('**/*',async route=>{
      const url=new URL(route.request().url());
      if(url.pathname==='/styles.css')return route.fulfill({contentType:'text/css',body:css});
      if(url.pathname.startsWith('/assets/'))return route.fulfill({path:'dist'+url.pathname});
      if(url.pathname==='/api/auto-mail/status'){await statusGate;return route.fulfill({json:{state:'READY',mailboxConnected:true,oauthReady:true,mailbox:'support@example.com',richRepliesReady:true,composeReady:true,schedulerReady:true,canManageMail:true,connectionVersion}});}
      if(url.pathname==='/api/auto-mail/mailbox-action'){const body=route.request().postDataJSON();assert.equal(body.connectionVersion,'v1');if(body.action==='unread'&&failUnread)return route.fulfill({status:503,json:{error:'Unable to mark unread.'}});assert.ok(['trash','restore','read','unread'].includes(body.action));if(['read','unread'].includes(body.action)){readChanges.push(body.action);gmailUnread=body.action==='unread';}else managed++;return route.fulfill({json:{completed:body.ids,failed:[]}});}
      if(url.pathname==='/api/auto-mail/compose'){const body=route.request().postDataJSON();assert.equal(body.to,'newcustomer@example.com');assert.equal(body.subject,'New registration');assert.match(body.bodyHtml,/New instructions/);assert.equal(body.connectionVersion,'v1');if(body.action==='unread'&&failUnread)return route.fulfill({status:503,json:{error:'Unable to mark unread.'}});assert.ok(body.requestId);assert.deepEqual(body.attachmentIds,[]);if(body.sendAt){scheduled=true;assert.ok(Date.parse(body.sendAt)>Date.now());return route.fulfill({json:{status:'QUEUED'}});}composeSends++;return route.fulfill({json:{status:'SENT'}});}
      if(url.pathname==='/api/auto-mail/outbox')return route.fulfill({json:{messages:scheduled?[{id:'job1',subject:'New registration',to_addresses:['newcustomer@example.com'],cc_addresses:[],bcc_addresses:[],attachments:[],send_at:new Date(Date.now()+600000).toISOString(),status:cancelled?'CANCELLED':'QUEUED',error:''}]:[],nextOffset:null,workerReady:true}});
      if(url.pathname==='/api/auto-mail/outbox-cancel'){cancelled=true;return route.fulfill({json:{status:'CANCELLED'}});}
      if(url.pathname==='/api/auto-mail/threads') {
        lists.push(url);
        const sent=url.searchParams.get('folder')==='sent'; const search=url.searchParams.get('q'); const more=url.searchParams.has('pageToken');
        return route.fulfill({json:{threads:search==='nothing'?[]:[{id:more?'thread2':'thread1',subject:more?'Second page':sent?'Sent registration instructions':'Registration help',from:'Customer <customer@example.com>',to:'customer@example.com',snippet:'Please review the registration documents.',unread:!sent&&gmailUnread,timestamp:Date.now(),messageCount:2}],nextPageToken:!more&&!search?'next-page':null}});
      }
      if(url.pathname==='/api/auto-mail/thread')return route.fulfill({json:{id:'thread1',subject:'Registration help',recipient:'customer@example.com',mailbox:'support@example.com',connectionVersion:'v1',replyBlocked:'',messages:[{id:'m1',from:'customer@example.com',to:'support@example.com',body:'Please help with registration.',date:'2026-10-22',outbound:false,attachments:false}]}});
      assert.ok(!url.pathname.startsWith('/api/'),'Unexpected API request: '+url.pathname);
      return route.fulfill({contentType:'text/html',body:`<meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css"><div id="root"></div><script>${bundle.outputFiles[0].text}</script>`});
    });
    await page.goto('http://localhost:3000/');
    await page.getByRole('status',{name:'Loading emails',exact:true}).waitFor();
    await page.getByRole('navigation',{name:'Mail folders'}).waitFor();
    await page.getByRole('searchbox',{name:'Search emails'}).waitFor();
    assert.equal(await page.getByText('Loading mailbox...', {exact:true}).count(),0);
    await page.screenshot({path:`test-results/auto-mail-initialization-${width}.png`,fullPage:true});
    releaseStatus();
    const folders=page.getByRole('navigation',{name:'Mail folders'});
    await page.getByRole('button',{name:/Customer.*Registration help/}).waitFor();
    const mailPanel=page.getByRole('region',{name:'Mail content',exact:true});
    const searchHeader=page.locator('header[aria-label="Mail search and tools"]');
    assert.equal(await mailPanel.getByRole('search',{name:'Search mail'}).count(),0,'Search stays outside the message panel');
    assert.equal(await mailPanel.getByRole('button',{name:'Auto Mail options',exact:true}).count(),0,'Tools stay outside the message panel');
    const searchButton=searchHeader.getByRole('button',{name:'Search',exact:true});
    const searchButtonBox=(await searchButton.boundingBox())!,searchContainerBox=(await searchButton.locator('..').boundingBox())!;
    const rightInset=searchContainerBox.x+searchContainerBox.width-searchButtonBox.x-searchButtonBox.width;
    assert.ok(Math.abs(rightInset-(searchButtonBox.y-searchContainerBox.y))<1.5,'Search right inset matches its top inset');
    assert.ok(Math.abs(rightInset-(searchContainerBox.y+searchContainerBox.height-searchButtonBox.y-searchButtonBox.height))<1.5,'Search right inset matches its bottom inset');
    const headerBox=(await searchHeader.boundingBox())!;const panelBox=(await mailPanel.boundingBox())!;
    assert.ok(headerBox.y+headerBox.height<=panelBox.y,'Search header sits above the message panel');
    const unreadGroup=page.getByRole('region',{name:'Unread',exact:true});
    const readGroup=page.getByRole('region',{name:'Everything else',exact:true});
    assert.equal(await unreadGroup.getByRole('button',{name:/^Unread/}).getAttribute('aria-expanded'),'true');
    assert.equal(await readGroup.getByRole('button',{name:/^Everything else/}).getAttribute('aria-expanded'),'true');
    await unreadGroup.getByRole('button',{name:/^Unread/}).click();
    assert.equal(await page.getByRole('button',{name:/Customer.*Registration help/}).count(),0);
    await unreadGroup.getByRole('button',{name:/^Unread/}).click();
    await page.getByRole('checkbox',{name:'Select Registration help',exact:true}).check();
    await page.getByText('1 selected',{exact:true}).waitFor();
    await page.getByRole('button',{name:'Show selected',exact:true}).click();
    await page.getByRole('button',{name:'Open selected',exact:true}).click();
    await page.getByRole('button',{name:'Reply',exact:true}).click();const editor=page.getByRole('textbox',{name:'Your reply',exact:true}); await editor.fill('Unsent draft');
    await page.getByRole('button',{name:'Mark as unread',exact:true}).waitFor();
    assert.deepEqual(readChanges,['read'],'Opening an unread email marks it read automatically');
    assert.equal(await page.getByRole('button',{name:'Mark as read',exact:true}).count(),0);
    assert.equal(await page.getByRole('button',{name:'Reload conversation',exact:true}).count(),0);
    const recipientRow=page.locator('section[aria-label="Conversation messages"] details[open] dl > div').first();
    assert.ok((await recipientRow.boundingBox())!.height<=20,'A single recipient uses one compact line');
    const google=page.getByRole('button',{name:/Click to refresh inbox/});
    const googleBox=(await google.boundingBox())!;
    for(const name of ['Back to Inbox','Mark as unread','Move conversation to Trash']) {
      const control=page.getByRole('button',{name,exact:true});
      const box=(await control.boundingBox())!;
      assert.ok(Math.abs(box.y+box.height/2-googleBox.y-googleBox.height/2)<2,`${name} shares the Google logo row`);
      assert.equal(await control.innerText(),'','Reader controls use icons');
    }
    await page.screenshot({path:`test-results/auto-mail-reader-toolbar-${width}.png`,fullPage:true});
    assert.match(await editor.innerText(),/Unsent draft/,'Read status changes preserve the reply');
    await page.getByRole('button',{name:'Back to Inbox',exact:true}).click();
    await page.getByRole('button',{name:'Show all',exact:true}).click();
    await readGroup.getByRole('button',{name:/Customer.*Registration help/}).waitFor();
    await readGroup.getByRole('button',{name:/Customer.*Registration help/}).click();
    failUnread=true;
    await page.getByRole('button',{name:'Mark as unread',exact:true}).click();
    await page.getByRole('alert').filter({hasText:'Unable to mark unread.'}).waitFor();
    assert.match(await editor.innerText(),/Unsent draft/,'A failed unread action keeps the reader and draft open');
    failUnread=false;
    await page.getByRole('button',{name:'Mark as unread',exact:true}).click();
    await page.getByText('1 conversation(s) marked as unread.',{exact:true}).waitFor();
    assert.equal(await page.getByRole('textbox',{name:'Your reply',exact:true}).count(),0,'Successful unread closes the reader');
    assert.equal(await page.getByRole('button',{name:'Back to Inbox',exact:true}).count(),0);
    assert.deepEqual(readChanges,['read','unread'],'Reopening an already-read cached email does not modify Gmail again');
    await unreadGroup.getByRole('button',{name:/Customer.*Registration help/}).waitFor();
    await page.getByRole('button',{name:/Customer.*Registration help/}).click();
    assert.match(await editor.innerText(),/Unsent draft/,'Back and reopening preserves rich draft');
    await page.waitForFunction(() => !(document.querySelector('button[aria-label="Mark as unread"]') as HTMLButtonElement)?.disabled);
    assert.deepEqual(readChanges,['read','unread','read'],'Reopening a cached unread email marks it read again');
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
    assert.match(await page.locator('[aria-label="Sent conversations"]').getByRole('button').first().innerText(),/Second page/,'Loaded Sent rows remain ordered by outgoing timestamp');
    assert.equal(lists.at(-1)!.searchParams.get('folder'),'sent');assert.equal(lists.at(-1)!.searchParams.get('pageToken'),'next-page');
    await page.getByRole('checkbox',{name:'Select all loaded conversations'}).check();
    await page.getByText('2 selected',{exact:true}).waitFor();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'No page overflow');
    await page.screenshot({path:`test-results/auto-mail-mailbox-${width}.png`,fullPage:true});
    await search.fill('nothing');await search.press('Enter');await page.getByText('No conversations match this search.',{exact:true}).waitFor();
    await folders.getByRole('button',{name:'Inbox',exact:true}).click();
    await page.getByRole('button',{name:/Customer.*Registration help/}).waitFor();
    assert.equal(await page.getByRole('searchbox',{name:'Search emails'}).inputValue(),'');
    // Changes originating in Gmail must move rows between groups on refresh.
    const refreshGoogle=page.getByRole('button',{name:/Click to refresh inbox/});
    for(const unread of [true,false,true]) {
      gmailUnread=unread;
      await refreshGoogle.click();
      await page.waitForFunction(() => !(document.querySelector('button[aria-label*="refresh inbox"]') as HTMLButtonElement)?.disabled);
      await (unread?unreadGroup:readGroup).getByRole('button',{name:/Customer.*Registration help/}).waitFor();
    }
    const mailboxBox=page.locator('nav[aria-label="Mail folders"]').locator('..').locator('..');
    const listHeight=(await mailboxBox.boundingBox())!.height;
    await page.getByRole('button',{name:/Customer.*Registration help/}).click();
    await page.getByRole('group',{name:'Conversation actions',exact:true}).waitFor();assert.equal(await page.getByRole('textbox',{name:'Your reply',exact:true}).count(),0,'Reader keeps the reply card closed');
    assert.equal(await page.getByRole('search',{name:'Search mail'}).count(),0,'Reader hides the search header');
    assert.equal((await mailboxBox.boundingBox())!.height,listHeight,'Reader keeps the mailbox height');
    page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'Move conversation to Trash',exact:true}).click();
    await page.getByText('1 conversation(s) moved to Trash.',{exact:true}).waitFor();
    await folders.getByRole('button',{name:'Trash',exact:true}).click();
    await page.getByRole('checkbox',{name:'Select Registration help',exact:true}).check();
    page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'Restore selected',exact:true}).click();
    await page.getByText('1 conversation(s) restored.',{exact:true}).waitFor();assert.equal(managed,2);
    const compose=async()=>{await folders.getByRole('button',{name:'Compose',exact:true}).click();await page.getByRole('combobox',{name:'Reply To recipients',exact:true}).fill('newcustomer@example.com');await page.getByRole('textbox',{name:'Message subject',exact:true}).fill('New registration');await page.getByRole('textbox',{name:'Your reply',exact:true}).fill('New instructions');};
    await compose();await page.getByRole('button',{name:'Send message',exact:true}).click();
    await page.getByText('Message sent through Gmail.',{exact:true}).waitFor();assert.equal(composeSends,1);
    await compose();
    const local=await page.evaluate(()=>{const date=new Date(Date.now()+600000);return new Date(date.getTime()-date.getTimezoneOffset()*60000).toISOString().slice(0,16);});
    await page.getByRole('button',{name:'Send options',exact:true}).click();await page.getByRole('menuitem',{name:'Schedule send',exact:true}).click();
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
