// Fully intercepted mail: no real Gmail calls or outgoing messages.
import assert from 'node:assert/strict';
import { readFile,readdir,mkdir } from 'node:fs/promises';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
const bundle=await build({stdin:{contents:`import React from 'react';import{createRoot}from'react-dom/client';import{AutoMail}from'./src/components/admin/AutoMail';createRoot(document.getElementById('root')).render(<AutoMail cacheScope="conversation-test"/>);`,loader:'tsx',resolveDir:process.cwd()},bundle:true,write:false,format:'iife',platform:'browser',define:{'process.env.NODE_ENV':'"test"'}});
const css=(await Promise.all((await readdir('dist/assets')).filter(file=>file.endsWith('.css')).map(file=>readFile('dist/assets/'+file,'utf8')))).join('\n');
await mkdir('test-results',{recursive:true});const browser=await chromium.launch({channel:'chrome',headless:true});
try {
  for(const width of [390,1440]) {
    const page=await browser.newPage({viewport:{width,height:1100}});const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
    let release!:()=>void;const gate=new Promise<void>(resolve=>release=resolve);
    let sends=0,uploads=0,removed=0,failCopy=false;const actions:string[]=[];const registered:string[]=[];
    const to='"Doe, John" <john@example.com>, Azhar <azhar@example.com>, support@example.com';
    const cc='Ahmad bin Ali <ahmad@example.com>, \u674e\u660e <li@example.com>';
    await page.route('**/*',async route=>{
      const url=new URL(route.request().url());
      if(url.pathname==='/styles.css')return route.fulfill({contentType:'text/css',body:css});
      if(url.pathname.startsWith('/auto-mail-preview/'))return route.fulfill({path:'public'+url.pathname,contentType:url.pathname.endsWith('.mjs')?'text/javascript':undefined});
      if(url.pathname.startsWith('/assets/'))return route.fulfill({path:'dist'+url.pathname});
      if(url.origin==='https://files.test') {
        assert.equal(route.request().headers()['cookie'],undefined);
        if(route.request().method()==='PUT'){uploads++;return route.fulfill({status:failCopy?500:200,json:{Key:'forwarded'}});}
        return route.fulfill({contentType:'application/pdf',body:Buffer.from('%PDF-forwarded original')});
      }
      if(url.pathname==='/api/auto-mail/status'){await gate;return route.fulfill({json:{state:'READY',mailboxConnected:true,oauthReady:true,mailbox:'support@example.com',connectionVersion:'v1',canManageMail:true,composeReady:true,richRepliesReady:true,knowledgeReady:true,aiEnabled:false}});}
      if(url.pathname==='/api/auto-mail/threads')return route.fulfill({json:{threads:[{id:'thread1',subject:'Forwarding and replies',from:'Jane <jane@example.com>',snippet:'Please review.',unread:false}],nextPageToken:null}});
      if(url.pathname==='/api/auto-mail/outbox')return route.fulfill({json:{messages:[],nextOffset:null,workerReady:true}});
      if(url.pathname==='/api/auto-mail/thread')return route.fulfill({json:{id:'thread1',subject:'Forwarding and replies',recipient:'jane@example.com',mailbox:'support@example.com',connectionVersion:'v1',replyBlocked:'',replyAll:{to:['jane@example.com','john@example.com','azhar@example.com'],cc:['ahmad@example.com','li@example.com']},messages:[{id:'m1',from:'"Doe, Jane" <jane@example.com>',to,cc,date:'2026-10-23T02:00:00Z',body:'Please review the original documents.',html:'<p>Please review the <strong>original documents</strong>.</p>',outbound:false,attachments:true,files:[{partId:'part1',name:'original.pdf',type:'application/pdf',size:23}]}]}});
      if(url.pathname==='/api/auto-mail/mailbox-action'){const body=route.request().postDataJSON();actions.push(body.action);return route.fulfill({json:{completed:body.ids,failed:[]}});}
      if(url.pathname==='/api/auto-mail/attachment'){assert.equal(url.searchParams.get('messageId'),'m1');return route.fulfill({json:{url:'https://files.test/original.pdf',name:'original.pdf',type:'application/pdf',size:23,previewable:true}});}
      if(url.pathname==='/api/auto-mail/attachment-upload') {const body=route.request().postDataJSON();assert.equal(body.threadId,'compose');assert.equal(body.sourceMessageId,'compose');assert.equal(body.connectionVersion,'v1');registered.push(body.requestId);return route.fulfill({json:{id:'upload1',name:'original.pdf',type:'application/pdf',size:body.size,uploadUrl:'https://files.test/upload'}});}
      if(url.pathname==='/api/auto-mail/attachment-remove'){removed++;return route.fulfill({json:{removed:true}});}
      if(url.pathname==='/api/auto-mail/compose'){sends++;const body=route.request().postDataJSON();assert.equal(body.requestId,registered[0]);assert.equal(body.subject,'Fwd: Forwarding and replies');assert.equal(body.to,'newrecipient@example.com');assert.equal(body.cc,'');assert.match(body.bodyHtml,/original documents/);assert.match(body.bodyHtml,/Doe, Jane/);assert.deepEqual(body.attachmentIds,['upload1']);assert.equal(body.threadId,undefined,'Forward sends as a new message');return route.fulfill({json:{status:'SENT'}});}
      assert.ok(!url.pathname.startsWith('/api/'),'Unexpected API '+url.pathname);
      return route.fulfill({contentType:'text/html',body:`<meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css"><div id="root"></div><script>${bundle.outputFiles[0].text}</script>`});
    });
    await page.goto('http://localhost:3000/');const title=page.getByRole('heading',{name:'AUTO MAIL',exact:true});await title.waitFor();
    const version=page.locator('[aria-label^="Auto Mail version"]');assert.match(await version.innerText(),/^v\d+\.\d+\.\d+$/);
    const headingBox=(await title.boundingBox())!;const versionBox=(await version.boundingBox())!;assert.ok(versionBox.y<headingBox.y+headingBox.height,'Version shares the title row');release();
    const open=()=>page.getByRole('button',{name:/Jane.*Forwarding and replies/}).click();await open();await page.getByRole('textbox',{name:'Your reply',exact:true}).waitFor();
    const count=page.getByText('1 message',{exact:true});await count.waitFor();const gmail=page.getByRole('link',{name:'Gmail',exact:true});const countBox=(await count.boundingBox())!,gmailBox=(await gmail.boundingBox())!;assert.ok(Math.abs(countBox.y+countBox.height/2-gmailBox.y-gmailBox.height/2)<2);
    assert.equal(await page.getByText(/message in this conversation/).count(),0);
    const message=page.locator('section[aria-label="Conversation messages"] details[open]').first();
    assert.equal(await message.locator('..').locator(':scope > span[aria-hidden="true"]').count(),1,'Avatar is outside the message card');
    const subject=page.getByRole('heading',{name:'Forwarding and replies',exact:true});const subjectBox=(await subject.boundingBox())!,messageBox=(await message.boundingBox())!;
    assert.ok(messageBox.y-subjectBox.y-subjectBox.height<=12,'Subject sits close to the first message card');
    const menuButton=page.getByRole('button',{name:'Message options',exact:true});await menuButton.click();const menu=page.getByRole('menu',{name:'Message actions',exact:true});
    assert.deepEqual(await menu.getByRole('menuitem').allTextContents(),['Reply','Reply all','Forward','Delete','Mark as unread']);
    await page.keyboard.press('Escape');await menu.waitFor({state:'hidden'});await menuButton.click();
    await menu.getByRole('menuitem',{name:'Mark as unread',exact:true}).click();
    const notification=page.getByRole('status').filter({hasText:'1 conversation(s) marked as unread.'});await notification.waitFor();assert.deepEqual(actions,['unread']);
    const snackbarBox=(await notification.boundingBox())!;assert.ok(snackbarBox.y>900,'Action notice appears at the bottom');
    assert.equal((await subject.boundingBox())!.y,subjectBox.y,'Notification does not shift the conversation');
    await notification.getByRole('button',{name:'Dismiss notification'}).click();await notification.waitFor({state:'hidden'});
    await menuButton.click();await menu.getByRole('menuitem',{name:'Reply all',exact:true}).click();
    await page.getByRole('button',{name:'Remove john@example.com from Reply To recipients',exact:true}).waitFor();
    const tag=page.getByRole('button',{name:'Remove john@example.com from Reply To recipients',exact:true}).locator('..');
    const tagColour=await tag.evaluate(element=>getComputedStyle(element).backgroundColor);assert.notEqual(tagColour,'rgba(0, 0, 0, 0)');
    await menuButton.click();await menu.getByRole('menuitem',{name:'Reply',exact:true}).click();
    const recipients=message.locator('dl');assert.ok((await recipients.boundingBox())!.height<=36,'To and CC remain single lines');
    await message.getByRole('button',{name:'Show all recipients',exact:true}).click();const popup=page.getByRole('dialog',{name:'All recipients',exact:true});await popup.waitFor();
    assert.equal(await popup.getByRole('region',{name:'To recipients',exact:true}).locator('li').count(),3);
    assert.equal(await popup.getByRole('region',{name:'CC recipients',exact:true}).locator('li').count(),2);
    await popup.getByText('Doe, John - john@example.com',{exact:true}).waitFor();await popup.getByText('\u674e\u660e - li@example.com',{exact:true}).waitFor();await page.keyboard.press('Escape');
    const box=page.getByRole('region',{name:'Reply box',exact:true});await box.getByRole('button',{name:'AI reply suggestion',exact:true}).click();await box.getByRole('complementary',{name:'AI reply suggestion'}).waitFor();await box.getByRole('button',{name:'Find an approved answer',exact:true}).click();await box.getByRole('complementary',{name:'Approved knowledge search'}).waitFor();await box.getByRole('button',{name:'Find an approved answer',exact:true}).click();
    assert.equal(await page.locator('form form').count(),0,'Helper forms do not nest inside the send form');
    const editor=page.getByRole('textbox',{name:'Your reply',exact:true});await editor.fill('Keep this reply draft');
    await page.getByRole('button',{name:'Reply all',exact:true}).click();await page.getByRole('button',{name:'Remove john@example.com from Reply To recipients',exact:true}).waitFor();
    await page.getByRole('button',{name:'Reply',exact:true}).click();await page.getByRole('button',{name:'Remove john@example.com from Reply To recipients',exact:true}).waitFor({state:'hidden'});assert.match(await editor.innerText(),/Keep this reply draft/);
    page.once('dialog',dialog=>dialog.dismiss());await menuButton.click();await menu.getByRole('menuitem',{name:'Delete',exact:true}).click();assert.deepEqual(actions,['unread'],'Cancelling Delete leaves the conversation intact');
    await page.screenshot({path:`test-results/auto-mail-conversation-${width}.png`,fullPage:true});
    page.once('dialog',dialog=>dialog.dismiss());await page.getByRole('button',{name:'Forward',exact:true}).click();assert.match(await editor.innerText(),/Keep this reply draft/,'Cancel forward preserves the reply');
    page.once('dialog',dialog=>dialog.accept());await menuButton.click();await menu.getByRole('menuitem',{name:'Forward',exact:true}).click();
    await page.getByRole('textbox',{name:'Message subject'}).waitFor();assert.equal(await page.getByRole('combobox',{name:'Reply To recipients'}).inputValue(),'');assert.equal(await page.getByRole('textbox',{name:'Message subject'}).inputValue(),'Fwd: Forwarding and replies');
    assert.match(await editor.innerText(),/original documents/);await page.getByRole('button',{name:'Remove original.pdf'}).waitFor();assert.equal(uploads,1);assert.equal(sends,0);
    await page.getByRole('combobox',{name:'Reply To recipients'}).fill('newrecipient@example.com');await page.getByRole('button',{name:'Send message',exact:true}).click();await page.getByText('Message sent through Gmail.',{exact:true}).waitFor();assert.equal(sends,1);
    // A failed attachment copy is visible and cannot silently disappear from a forward.
    failCopy=true;await open();await page.getByRole('button',{name:'Forward',exact:true}).click();await page.getByRole('textbox',{name:'Message subject'}).waitFor();
    await page.getByText(/These attachments could not be copied: original.pdf/).waitFor();assert.equal(removed,1);assert.equal(sends,1);assert.match(await editor.innerText(),/original documents/);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.deepEqual(errors,[]);await page.close();
  }
  console.log('Conversation layout, recipients popup, reply helpers, reply/reply-all, forward with copied attachments, cancellation and copy failures passed on mobile/desktop.');
}finally{await browser.close();}
