// Offline clipboard and automatic scope checks; all requests are intercepted.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import { readFile, readdir } from 'node:fs/promises';
const bundle=await build({stdin:{contents:`
import React,{useState,useEffect} from 'react';import{createRoot}from'react-dom/client';
import{AutoMailComposer}from'./src/components/admin/AutoMailComposer';import{AutoMailAiDraft}from'./src/components/admin/AutoMailAiDraft';
function App(){const saved=JSON.parse(localStorage.getItem('fixture')||'{}');const[body,setBody]=useState(saved.body||''),[html,setHtml]=useState(saved.html||''),[files,setFiles]=useState(saved.files||[]),[busy,setBusy]=useState(false);useEffect(()=>{localStorage.setItem('fixture',JSON.stringify({body,html,files}));},[body,html,files]);
return <AutoMailComposer body={body} html={html} onChange={(b,h)=>{setBody(b);setHtml(h)}} to="customer@example.com" cc="" bcc="" onRecipients={()=>{}} replyAll={{to:[],cc:[]}} onReplyAll={()=>{}} mailbox="support@example.com" files={files} onFiles={setFiles} requestId="10000000-0000-4000-8000-000000000001" threadId="thread1" sourceMessageId="m1" connectionVersion="v1" richReady disabled={busy} sending={false} onSend={()=>{window.sent=(window.sent||0)+1}} onBusyChange={setBusy} helpers={{ai:<AutoMailAiDraft threadId="thread1" sourceMessageId="m1" connectionVersion="v1" enabled disabled={busy} setupMessage="" onBusyChange={setBusy} onUse={(b)=>{setBody(body+'\\n'+b);setHtml(html+'<p>'+b+'</p>')}}/>}}/>}
createRoot(document.getElementById('root')).render(<App/>);`,loader:'tsx',resolveDir:process.cwd()},bundle:true,write:false,format:'iife',platform:'browser',define:{'process.env.NODE_ENV':'"test"'}});
const css=(await Promise.all((await readdir('dist/assets')).filter(x=>x.endsWith('.css')).map(x=>readFile('dist/assets/'+x,'utf8')))).join('\n');
const browser=await chromium.launch({channel:'chrome',headless:true});
try{for(const width of [390,1440]){
 const page=await browser.newPage({viewport:{width,height:1100}});const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 let uploads=0,fail=false,scopeReads=0,previews=0,offerDraft=false,stale=false,uses=0;const draft={id:'draft1',status:'NEEDS_REVIEW',body:'AI registration instructions.',reviewNotes:'Confirm the port.',provider:'OpenAI',model:'fixture',sources:[]};const generated:string[]=[];
 await page.route('**/*',async route=>{
  const url=new URL(route.request().url());
  if(url.pathname==='/styles.css')return route.fulfill({contentType:'text/css',body:css});
  if(url.origin==='https://files.test'){if(route.request().method()==='PUT'){uploads++;return route.fulfill({status:fail?500:200,body:''});}return route.fulfill({contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64')});}
  if(url.pathname==='/api/auto-mail/draft-attachment'){previews++;assert.equal(url.searchParams.get('threadId'),'thread1');return route.fulfill({json:{url:'https://files.test/preview.png'}});}
  if(url.pathname==='/api/auto-mail/ai-scope'){scopeReads++;return route.fulfill({json:{recommendation:{scope:'NORTHPORT',reason:'Suggested NORTHPORT from the email subject and current message.',scopes:['NORTHPORT','WESTPORT']}}});}
  if(url.pathname==='/api/auto-mail/ai-generate'){generated.push(route.request().postDataJSON().scope);return route.fulfill({json:offerDraft?{draft}:{message:'No approved KB articles matched.'}});}
  if(url.pathname==='/api/auto-mail/ai-use'){uses++;return route.fulfill(stale?{status:409,json:{error:'KB sources changed.'}}:{json:{draft}});}
  if(url.pathname==='/api/auto-mail/attachment-upload'){const body=route.request().postDataJSON();assert.match(body.name,/\.png$/);return route.fulfill({json:{id:'10000000-0000-4000-8000-'+String(uploads+1).padStart(12,'0'),name:body.name,type:'image/png',size:body.size,uploadUrl:'https://files.test/upload'}});}
  if(url.pathname==='/api/auto-mail/attachment-remove')return route.fulfill({json:{removed:true}});
  assert.ok(!url.pathname.startsWith('/api/'),'Unexpected API '+url.pathname);
  return route.fulfill({contentType:'text/html',body:`<meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css"><div id="root"></div><script>${bundle.outputFiles[0].text}</script>`});
 });
 await page.goto('http://localhost:3000/');await page.getByText('Suggested NORTHPORT from the email subject and current message.',{exact:true}).waitFor();assert.equal(scopeReads,1);assert.deepEqual(generated,[],'Opening an email does not call generation');
 const editor=page.getByRole('textbox',{name:'Your reply',exact:true});await editor.fill('Before image');await editor.press('End');
 const paste=()=>editor.evaluate(element=>{const data=new DataTransfer();const bytes=Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII='),c=>c.charCodeAt(0));data.items.add(new File([bytes],'image.png',{type:'image/png'}));element.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));});
 await paste();await page.waitForFunction(()=>!!document.querySelector('[aria-label="Your reply"] img')?.getAttribute('src')?.startsWith('blob:'));
 assert.equal(uploads,1);assert.match(await editor.innerText(),/Before image/);assert.match(await editor.innerHTML(),/data-mail-image="cid:upload-/);assert.equal(await editor.locator('img').evaluate((image:HTMLImageElement)=>image.complete&&image.naturalWidth>0),true);
 await page.reload();await page.waitForFunction(()=>!!document.querySelector('[aria-label="Your reply"] img')?.getAttribute('src')?.startsWith('https://files.test/'));assert.equal(previews,1,'Reopened images use authenticated preview');
 await page.getByRole('button',{name:/Remove pasted-image/}).click();await editor.locator('img').waitFor({state:'detached'});assert.equal(await editor.locator('img').count(),0);
 fail=true;await editor.focus();await paste();await page.getByRole('alert').filter({hasText:'Upload failed.'}).waitFor();assert.equal(await editor.locator('img').count(),0);assert.match(await editor.innerText(),/Before image/);
 await editor.evaluate(element=>{const data=new DataTransfer();data.setData('text/html','<b>Formatted paste</b><script>bad()</script>');element.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));});assert.match(await editor.innerHTML(),/<b>Formatted paste<\/b>/);assert.equal(await editor.locator('script').count(),0);
 const generate=page.getByRole('button',{name:'Generate AI draft',exact:true});await generate.click();await page.getByText('No approved KB articles matched.',{exact:true}).waitFor();assert.deepEqual(generated,['']);
 await page.getByLabel('Port / scope',{exact:true}).selectOption('WESTPORT');await generate.click();await page.getByText('No approved KB articles matched.',{exact:true}).waitFor();assert.deepEqual(generated,['','WESTPORT']);
 offerDraft=true;await generate.click();const preview=page.getByLabel('Unconfirmed AI reply',{exact:true});await preview.waitFor();
 assert.match(await page.getByRole('form',{name:'Reply composer'}).innerText(),/AI registration instructions/);assert.doesNotMatch(await editor.innerText(),/AI registration instructions/);assert.equal(uses,0);
 const send=page.getByRole('button',{name:'Send reply',exact:true});assert.equal(await send.isDisabled(),true);assert.equal(await page.getByRole('button',{name:'Send options',exact:true}).isDisabled(),true);
 await page.getByRole('form',{name:'Reply composer'}).evaluate(element=>element.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));assert.equal(await page.evaluate(()=>(window as any).sent||0),0,'Form submit cannot bypass pending confirmation');
 await page.getByRole('button',{name:'AI reply suggestion',exact:true}).click();assert.equal(await preview.isVisible(),true,'Preview remains visible when helper controls collapse');
 stale=true;await page.getByRole('button',{name:'Insert AI draft',exact:true}).click();await preview.getByRole('alert').waitFor();assert.equal(await send.isDisabled(),true);assert.doesNotMatch(await editor.innerText(),/AI registration instructions/);
 await page.getByRole('button',{name:'Discard suggestion',exact:true}).click();await preview.waitFor({state:'detached'});assert.equal(await send.isEnabled(),true);assert.match(await editor.innerText(),/Before image/);
 await page.getByRole('button',{name:'AI reply suggestion',exact:true}).click();await generate.click();await preview.waitFor();stale=false;await page.getByRole('button',{name:'Insert AI draft',exact:true}).click();await preview.waitFor({state:'detached'});assert.match(await editor.innerText(),/AI registration instructions/);assert.match(await editor.innerText(),/Before image/);assert.equal(await send.isEnabled(),true);assert.equal(uses,2);await send.click();assert.equal(await page.evaluate(()=>(window as any).sent),1);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.deepEqual(errors,[]);await page.close();
}console.log('Clipboard image upload, inline preview/removal, upload failures, sanitized text paste, automatic scope and overrides passed on mobile/desktop.');}finally{await browser.close();}
