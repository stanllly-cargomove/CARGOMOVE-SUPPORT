import assert from 'node:assert/strict';
import { readFile, readdir, mkdir } from 'node:fs/promises';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

const bundle=await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {AutoMail} from './src/components/admin/AutoMail';createRoot(document.getElementById('root')).render(<main className="p-4"><AutoMail onOpenConfig={()=>{}}/></main>);`,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,format:'iife',platform:'browser',define:{'process.env.NODE_ENV':'"test"'}});
const css=(await Promise.all((await readdir('dist/assets')).filter(f=>f.endsWith('.css')).map(f=>readFile('dist/assets/'+f,'utf8')))).join('\n');
await mkdir('test-results',{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
  for(const width of [390,1440]){
    const context=await browser.newContext({viewport:{width,height:1100},reducedMotion:'reduce'});const page=await context.newPage();page.setDefaultTimeout(15000);
    let sends=0,uploads=0,inboxLoads=0,removed=0;const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
    const status={state:'READY',message:'Gmail connected.',mailboxConnected:true,oauthReady:true,mailbox:'support@example.com',knowledgeReady:false,aiEnabled:false,learningReady:false,richRepliesReady:true};
    await context.route('**/*',async route=>{
      const url=new URL(route.request().url());
      if(url.origin==='https://files.test'){
        if(route.request().method()==='PUT'){uploads++;assert.equal(route.request().headers()['x-upsert'],'false');assert.equal(route.request().headers()['cookie'],undefined);return route.fulfill({json:{Key:'private/file'}});}
        return route.fulfill({contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6dVwAAAAASUVORK5CYII=','base64')});
      }
      assert.equal(url.origin,'http://localhost:3000');
      if(url.pathname==='/styles.css')return route.fulfill({contentType:'text/css',body:css});
      if(url.pathname.startsWith('/assets/'))return route.fulfill({path:'dist'+url.pathname});
      if(url.pathname==='/api/auto-mail/status')return route.fulfill({json:status});
      if(url.pathname==='/api/auto-mail/threads'){inboxLoads++;return route.fulfill({json:{threads:[{id:'thread1',subject:'Container documents and portal access',from:'Customer <customer@example.com>',snippet:'Please review the attached files.',unread:true}],nextPageToken:null}});}
      if(url.pathname==='/api/auto-mail/thread')return route.fulfill({json:{id:'thread1',subject:'Container documents and portal access',mailbox:'support@example.com',connectionVersion:'connection1',recipient:'customer@example.com',replyBlocked:'',replyAll:{to:['customer@example.com','colleague@example.com'],cc:['team@example.com']},messages:[{id:'old1',from:'support@example.com',to:'customer@example.com',date:'2026-10-22T00:00:00Z',body:'Earlier reply',outbound:true,attachments:false},{id:'message1',from:'Customer <customer@example.com>',to:'support@example.com, colleague@example.com',cc:'team@example.com',date:'2026-10-22T01:00:00Z',body:'Please review the documents at https://example.com/help.\n\n> Previous conversation',html:'<h2>Document review</h2><p>Please review the documents in the <a href="https://example.com/help">customer portal</a> and let us know the next step.</p><table><tr><th>Container</th><th>Status</th></tr><tr><td>TEST1234567</td><td>Pending review</td></tr></table><blockquote>Previous conversation and quoted history</blockquote><img src="https://tracker.invalid/x" onerror="window.mailXss=true"><script>window.mailXss=true</script>',outbound:false,attachments:true,files:[{partId:'1',name:'container.png',type:'image/png',size:1000},{partId:'2',name:'documents.pdf',type:'application/pdf',size:5000}]}]}});
      if(url.pathname==='/api/auto-mail/attachment')return route.fulfill({json:{url:'https://files.test/preview.png',name:'container.png',type:'image/png',size:1000,previewable:true}});
      if(url.pathname==='/api/auto-mail/attachment-upload'){const data=route.request().postDataJSON();assert.equal(data.threadId,'thread1');assert.equal(data.sourceMessageId,'message1');assert.ok(data.requestId);return route.fulfill({json:{id:'10000000-0000-4000-8000-000000000005',name:data.name,type:'application/pdf',size:data.size,uploadUrl:'https://files.test/upload'}});}
      if(url.pathname==='/api/auto-mail/attachment-remove'){removed++;return route.fulfill({json:{removed:true}});}
      if(url.pathname==='/api/auto-mail/reply'){
        const data=route.request().postDataJSON();if(data.cc.includes('invalid'))return route.fulfill({status:400,json:{error:'Check the CC addresses.',canEditReply:true}});sends++;assert.equal(data.recipient,'customer@example.com');assert.equal(data.to,'customer@example.com, colleague@example.com');assert.equal(data.cc,'team@example.com, additional@example.com');assert.equal(data.bcc,'hidden@example.com');assert.match(data.bodyHtml,/<(?:b|strong)>/);assert.match(data.bodyHtml,/https:\/\/example.com\/guide/);assert.deepEqual(data.attachmentIds,['10000000-0000-4000-8000-000000000005']);assert.ok(!JSON.stringify(data).includes('%PDF-'),'File bytes bypass the application API');return route.fulfill({json:{status:'SENT',deliveryId:'delivery1'}});
      }
      assert.ok(!url.pathname.startsWith('/api/'),'Unexpected API '+url.pathname);
      return route.fulfill({contentType:'text/html',body:`<meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css"><div id="root"></div><script>${bundle.outputFiles[0].text}</script>`});
    });
    await page.goto('http://localhost:3000/');await page.getByRole('button',{name:/Container documents/}).click();
    const reader=page.getByRole('region',{name:'Conversation messages'});
    // Sections without headings are not automatically regions; use their explicit label.
    const content=page.locator('section[aria-label="Conversation messages"]');
    await content.getByRole('heading',{name:'Document review',exact:true}).waitFor();
    const link=content.getByRole('link',{name:'customer portal',exact:true});assert.equal(await link.getAttribute('target'),'_blank');
    assert.equal(await content.getByRole('cell',{name:'TEST1234567',exact:true}).count(),1);
    assert.equal(await page.evaluate(()=>(window as any).mailXss),undefined);assert.equal(await page.locator('img[src*="tracker.invalid"]').count(),0);
    assert.equal(await content.getByText('Earlier reply',{exact:true}).isVisible(),false);
    await content.locator('summary').filter({hasText:'Show quoted history'}).click();await content.getByText('Previous conversation and quoted history',{exact:true}).waitFor();
    await page.getByRole('button',{name:'Preview container.png',exact:true}).click();
    await page.getByRole('dialog',{name:'Attachment preview'}).waitFor();await page.getByRole('img',{name:'container.png',exact:true}).waitFor();await page.keyboard.press('Escape');
    await page.getByRole('button',{name:'Reply all',exact:true}).click();await page.getByRole('combobox',{name:'Reply CC recipients',exact:true}).fill('team@example.com, additional@example.com');
    await page.getByRole('button',{name:'BCC',exact:true}).click();await page.getByRole('combobox',{name:'Reply BCC recipients',exact:true}).fill('hidden@example.com');
    const editor=page.getByRole('textbox',{name:'Your reply',exact:true});await editor.fill('Please check the attached guide.');await editor.press('ControlOrMeta+A');await page.getByRole('button',{name:'Bold',exact:true}).click();
    await editor.press('ControlOrMeta+End');await page.getByRole('button',{name:'Insert reply link',exact:true}).click();await page.getByRole('textbox',{name:'Reply link text',exact:true}).fill('Portal guide');await page.getByRole('textbox',{name:'Reply link URL',exact:true}).fill('https://example.com/guide');await page.getByRole('button',{name:'Insert link',exact:true}).click();
    const before=await editor.innerHTML();const previousLoads=inboxLoads;await page.getByRole('button',{name:/Click to refresh inbox/}).click();await page.waitForFunction(()=>document.querySelector('button[aria-busy="false"][aria-label*="refresh inbox"]'));assert.equal(await editor.innerHTML(),before);assert.equal(inboxLoads,previousLoads+1);
    const file={name:'guide.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-attachment')};
    await page.getByLabel('Attach reply files',{exact:true}).setInputFiles(file);await page.getByRole('button',{name:'Remove guide.pdf',exact:true}).waitFor();assert.equal(uploads,1);
    await page.getByRole('button',{name:'Remove guide.pdf',exact:true}).click();await page.getByRole('button',{name:'Remove guide.pdf',exact:true}).waitFor({state:'detached'});assert.equal(removed,1);
    await page.getByLabel('Attach reply files',{exact:true}).setInputFiles(file);await page.getByRole('button',{name:'Remove guide.pdf',exact:true}).waitFor();
    await page.getByRole('button',{name:'Send reply',exact:true}).waitFor({state:'visible'});assert.equal(sends,0);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true,'Rich mail has no horizontal page overflow');
    await page.screenshot({path:`test-results/auto-mail-rich-${width}.png`,fullPage:true});
    await page.getByRole('combobox',{name:'Reply CC recipients',exact:true}).fill('invalid');await page.getByRole('button',{name:'Send reply',exact:true}).click();await page.getByText('Check the CC addresses.',{exact:true}).waitFor();assert.equal(await editor.getAttribute('contenteditable'),'true','Pre-send validation errors allow correction without losing the draft');assert.equal(sends,0);await page.getByRole('combobox',{name:'Reply CC recipients',exact:true}).fill('team@example.com, additional@example.com');
    await page.getByRole('button',{name:'Send reply',exact:true}).click();await page.getByText(/Reply sent through Gmail/).waitFor();assert.equal(sends,1);assert.equal(await editor.getAttribute('contenteditable'),'false');
    assert.deepEqual(errors,[]);await context.close();
  }
  console.log('Rich Auto Mail: sanitized HTML/tables/links, CC/BCC and reply-all, attachment preview/upload/removal, formatting, and preserved drafts passed at mobile/desktop widths.');
}finally{await browser.close();}
