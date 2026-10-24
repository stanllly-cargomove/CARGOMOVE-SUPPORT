// All mailbox and document requests are intercepted. No live mail is accessed.
import assert from 'node:assert/strict';
import {readFile,readdir,mkdir} from 'node:fs/promises';
import {build} from 'esbuild';
import {chromium} from 'playwright-core';
import {zipSync,strToU8} from 'fflate';
import * as XLSX from 'xlsx';

function pdf(){
 const stream='0.1 0.4 0.8 rg 40 130 200 50 re f BT /F1 16 Tf 40 100 Td (Container document preview) Tj ET';
 const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R 6 0 R] /Count 2 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 220] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 800] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>'];
 let value='%PDF-1.4\n';const offsets=[0];objects.forEach((object,index)=>{offsets.push(Buffer.byteLength(value));value+=`${index+1} 0 obj\n${object}\nendobj\n`;});
 const start=Buffer.byteLength(value);value+=`xref\n0 7\n0000000000 65535 f \n${offsets.slice(1).map(offset=>String(offset).padStart(10,'0')+' 00000 n \n').join('')}trailer\n<< /Size 7 /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`;return Buffer.from(value);
}
const workbook=XLSX.utils.book_new();XLSX.utils.book_append_sheet(workbook,XLSX.utils.aoa_to_sheet([['Container','Status'],['TEST1234567','Approved']]),'Containers');
const docx=zipSync({'[Content_Types].xml':strToU8('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'),'_rels/.rels':strToU8('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'),'word/document.xml':strToU8('<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Verified Word document preview</w:t></w:r></w:p></w:body></w:document>')});
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6dVwAAAAASUVORK5CYII=','base64');
const fixtures=[{partId:'pdf',name:'permit.pdf',type:'application/pdf',data:pdf()},{partId:'excel',name:'containers.xlsx',type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',data:Buffer.from(XLSX.write(workbook,{type:'array',bookType:'xlsx'}))},{partId:'word',name:'guide.docx',type:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',data:Buffer.from(docx)},{partId:'image',name:'photo.png',type:'image/png',data:png},{partId:'legacy',name:'legacy.doc',type:'application/octet-stream',data:Buffer.from('legacy binary')}];
const logo={partId:'logo',name:'image001.png',type:'image/png',size:png.length,contentId:'signature@mail',disposition:'inline'};
const message={id:'m1',from:'Customer <customer@example.com>',to:'support@example.com',date:'2026-10-23T02:00:00Z',body:'Regards',html:'<p>Regards</p><img data-mail-image="cid:signature@mail" alt="Company logo" width="120" height="40"><img data-mail-image="https://remote.test/banner.png" alt="External banner" width="120" height="40">',outbound:false,attachments:true,files:fixtures.map(({data,...file})=>({...file,size:data.length})),inlineImages:[logo]};
const bundle=await build({stdin:{contents:`import React from 'react';import{createRoot}from'react-dom/client';import{AutoMailReader}from'./src/components/admin/AutoMailReader';createRoot(document.getElementById('root')).render(<React.StrictMode><main style={{padding:12}}><AutoMailReader threadId="thread1" messages={${JSON.stringify([message])}}/></main></React.StrictMode>);`,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,format:'iife',platform:'browser',define:{'process.env.NODE_ENV':'"development"'}});
const css=(await Promise.all((await readdir('dist/assets')).filter(name=>name.endsWith('.css')).map(name=>readFile('dist/assets/'+name,'utf8')))).join('\n');await mkdir('test-results',{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
try{for(const width of [390,1440]){
 const page=await browser.newPage({viewport:{width,height:1100}});page.setDefaultTimeout(20000);const errors:string[]=[];const reads=new Map<string,number>();let external=0;page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/*',async route=>{
  const url=new URL(route.request().url());
  if(url.origin==='https://remote.test'){external++;return route.fulfill({body:png,contentType:'image/png'});}
  if(url.origin==='https://files.test'){assert.equal(route.request().headers()['cookie'],undefined);const file=fixtures.find(file=>url.pathname==='/'+file.partId);return route.fulfill({body:file?.data||png,contentType:file?.type||'image/png',headers:{'Access-Control-Allow-Origin':'*'}});}
  assert.equal(url.origin,'http://localhost:3000');
  if(url.pathname==='/styles.css')return route.fulfill({body:css,contentType:'text/css'});
  if(url.pathname.startsWith('/auto-mail-preview/'))return route.fulfill({path:'public'+url.pathname,contentType:url.pathname.endsWith('.mjs')?'text/javascript':url.pathname.endsWith('.wasm')?'application/wasm':'application/octet-stream'});
  if(url.pathname==='/api/auto-mail/attachment'){
   assert.equal(url.searchParams.get('threadId'),'thread1');assert.equal(url.searchParams.get('messageId'),'m1');const id=url.searchParams.get('partId')!;if(url.searchParams.get('download')==='0')reads.set(id,(reads.get(id)||0)+1);const file=fixtures.find(file=>file.partId===id)||logo;return route.fulfill({json:{url:'https://files.test/'+id,name:file.name,type:file.type,size:'data' in file?file.data.length:logo.size,previewable:file.type!=='application/octet-stream'}});
  }
  assert.ok(!url.pathname.startsWith('/api/'),'Unexpected API request '+url.pathname);
  return route.fulfill({contentType:'text/html',body:`<meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css"><div id="root"></div><script>${bundle.outputFiles[0].text}</script>`});
 });
 await page.goto('http://localhost:3000/');await page.getByText('Attachments (5)',{exact:true}).waitFor();
 const bodyLogo=page.locator('.auto-mail-content img[alt="Company logo"]');await bodyLogo.waitFor();await page.waitForFunction(()=>Boolean((document.querySelector('img[alt="Company logo"]') as HTMLImageElement)?.naturalWidth));assert.equal(await page.getByRole('button',{name:'Preview image001.png',exact:true}).count(),0);
 assert.equal(await page.getByRole('button',{name:'Show external images',exact:true}).count(),0);await page.locator('img[alt="External banner"]').waitFor();await page.waitForFunction(()=>Boolean((document.querySelector('img[alt="External banner"]') as HTMLImageElement)?.naturalWidth));assert.equal(external,1);
 const tile=page.getByRole('button',{name:'Preview permit.pdf',exact:true});await tile.scrollIntoViewIfNeeded();await tile.locator('canvas').waitFor();await page.waitForFunction(()=>{const canvas=document.querySelector('button[aria-label="Preview permit.pdf"] canvas') as HTMLCanvasElement;if(!canvas?.width)return false;const pixel=canvas.getContext('2d')!.getImageData(40,55,1,1).data;return pixel[0]<100&&pixel[2]>150&&pixel[3]===255;});
 if(width===1440){const first=(await tile.boundingBox())!,second=(await page.getByRole('button',{name:'Preview containers.xlsx',exact:true}).boundingBox())!;assert.equal(first.y,second.y,'Attachments use multiple columns');}
 const row=page.locator('[aria-label="Attachment row"]');
 const boxes=await row.locator(':scope > *').evaluateAll(elements=>elements.map(element=>element.getBoundingClientRect().toJSON()));
 assert.ok(boxes.every(box=>Math.abs(box.y-boxes[0].y)<1),'Attachments stay on one row');
 const more=page.getByRole('button',{name:/Show \d+ more attachments/});
 const openAttachment=async(name:string)=>{
  const button=page.getByRole('button',{name:'Preview '+name,exact:true});
  if(!await button.isVisible()){await more.click();await page.getByRole('dialog',{name:'All attachments',exact:true}).waitFor();}
  await page.getByRole('button',{name:'Preview '+name,exact:true}).click();
 };
 if(width===390){await more.click();const list=page.getByRole('dialog',{name:'All attachments',exact:true});assert.equal(await list.getByRole('listitem').count(),5);await list.getByRole('button',{name:'Close attachment list',exact:true}).click();}
 await tile.click();const dialog=page.getByRole('dialog',{name:'Attachment preview'});
 const pageNumber=dialog.getByRole('spinbutton',{name:'PDF page number',exact:true});await pageNumber.waitFor();assert.equal(await pageNumber.inputValue(),'1');
 await dialog.getByRole('button',{name:'Next PDF page',exact:true}).click();assert.equal(await pageNumber.inputValue(),'2');
 const controls=dialog.locator('[aria-label="PDF controls"]'),controlBox=(await controls.boundingBox())!;
 await dialog.locator('[aria-label="PDF document pages"]').evaluate(element=>element.scrollTop=10000);
 assert.equal((await controls.boundingBox())!.y,controlBox.y,'Page controls stay fixed at the bottom while the PDF scrolls');
 await dialog.getByRole('button',{name:'Enter full screen',exact:true}).click();
 const fullBox=(await dialog.boundingBox())!;assert.equal(fullBox.width,width);assert.equal(fullBox.height,1100);
 const thumbnails=dialog.getByRole('complementary',{name:'PDF page thumbnails',exact:true});await thumbnails.waitFor();
 await thumbnails.getByRole('button',{name:'Go to PDF page 1',exact:true}).click();assert.equal(await pageNumber.inputValue(),'1');
 await dialog.getByRole('button',{name:'Zoom in',exact:true}).click();await dialog.getByRole('button',{name:'Fit PDF to width',exact:true}).filter({hasText:'125%'}).waitFor();
 await dialog.getByRole('button',{name:'Fit PDF to width',exact:true}).click();
 const popupPromise=page.waitForEvent('popup');await dialog.getByRole('link',{name:'Open PDF in new tab',exact:true}).click();const popup=await popupPromise;await popup.waitForURL(/^blob:/);await popup.close();
 const downloadRequest=page.waitForRequest(request=>request.url().includes('/api/auto-mail/attachment?')&&new URL(request.url()).searchParams.get('download')==='1');
 await dialog.getByRole('button',{name:'Download attachment',exact:true}).click();await downloadRequest;
 await page.evaluate(()=>{(window as any).pdfPrintCalled=false;new MutationObserver(()=>{const frame=document.querySelector<HTMLIFrameElement>('iframe[data-mail-print]');if(frame?.contentWindow)frame.contentWindow.print=()=>{(window as any).pdfPrintCalled=true;};}).observe(document.body,{childList:true,subtree:true});});
 await dialog.getByRole('button',{name:'Print PDF',exact:true}).click();await page.waitForFunction(()=>(window as any).pdfPrintCalled===true);
 assert.equal(await page.locator('iframe[data-mail-print]').contentFrame().locator('canvas').count(),2,'Printing renders every page');
 await page.screenshot({path:`test-results/auto-mail-pdf-fullscreen-${width}.png`,fullPage:true});
 await dialog.getByRole('button',{name:'Exit full screen',exact:true}).click();await page.keyboard.press('Escape');
 await openAttachment('containers.xlsx');await dialog.getByRole('cell',{name:'TEST1234567',exact:true}).waitFor();await dialog.getByRole('cell',{name:'Approved',exact:true}).waitFor();await page.keyboard.press('Escape');
 await openAttachment('guide.docx');await dialog.frameLocator('iframe').getByText('Verified Word document preview',{exact:true}).waitFor();assert.equal(await dialog.locator('iframe').getAttribute('sandbox'),'');await page.keyboard.press('Escape');
 await openAttachment('legacy.doc');await dialog.getByText(/Preview unavailable for this format/).waitFor();await page.keyboard.press('Escape');
 await openAttachment('photo.png');await dialog.getByRole('img',{name:'photo.png',exact:true}).waitFor();await page.keyboard.press('Escape');
 assert.equal(reads.get('pdf'),1,'Thumbnail and viewer reuse the authenticated attachment request');assert.equal(reads.get('logo'),1);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'No horizontal page overflow');
 await page.screenshot({path:`test-results/auto-mail-attachments-${width}.png`,fullPage:true});assert.deepEqual(errors,[]);await page.close();
}console.log('Attachment previews passed: PDF canvas, XLSX cells, DOCX document, image, legacy fallback, inline logo, automatic external images, single-row/mobile layout, overflow list and full-screen PDF tools and cached reads.');}finally{await browser.close();}
