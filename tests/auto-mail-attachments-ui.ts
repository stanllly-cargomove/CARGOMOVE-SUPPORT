// All mailbox and document requests are intercepted. No live mail is accessed.
import assert from 'node:assert/strict';
import {readFile,readdir,mkdir} from 'node:fs/promises';
import {build} from 'esbuild';
import {chromium} from 'playwright-core';
import {zipSync,strToU8} from 'fflate';
import * as XLSX from 'xlsx';

function pdf(){
 const stream='0.1 0.4 0.8 rg 40 130 200 50 re f BT /F1 16 Tf 40 100 Td (Container document preview) Tj ET';
 const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 220] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`];
 let value='%PDF-1.4\n';const offsets=[0];objects.forEach((object,index)=>{offsets.push(Buffer.byteLength(value));value+=`${index+1} 0 obj\n${object}\nendobj\n`;});
 const start=Buffer.byteLength(value);value+=`xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(offset=>String(offset).padStart(10,'0')+' 00000 n \n').join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`;return Buffer.from(value);
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
   assert.equal(url.searchParams.get('threadId'),'thread1');assert.equal(url.searchParams.get('messageId'),'m1');const id=url.searchParams.get('partId')!;reads.set(id,(reads.get(id)||0)+1);const file=fixtures.find(file=>file.partId===id)||logo;return route.fulfill({json:{url:'https://files.test/'+id,name:file.name,type:file.type,size:'data' in file?file.data.length:logo.size,previewable:file.type!=='application/octet-stream'}});
  }
  assert.ok(!url.pathname.startsWith('/api/'),'Unexpected API request '+url.pathname);
  return route.fulfill({contentType:'text/html',body:`<meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css"><div id="root"></div><script>${bundle.outputFiles[0].text}</script>`});
 });
 await page.goto('http://localhost:3000/');await page.getByText('Attachments (5)',{exact:true}).waitFor();
 const bodyLogo=page.locator('.auto-mail-content img[alt="Company logo"]');await bodyLogo.waitFor();await page.waitForFunction(()=>Boolean((document.querySelector('img[alt="Company logo"]') as HTMLImageElement)?.naturalWidth));assert.equal(await page.getByRole('button',{name:'Preview image001.png',exact:true}).count(),0);assert.equal(external,0);
 await page.getByRole('button',{name:'Show external images',exact:true}).click();await page.locator('img[alt="External banner"]').waitFor();await page.waitForFunction(()=>Boolean((document.querySelector('img[alt="External banner"]') as HTMLImageElement)?.naturalWidth));assert.equal(external,1);
 const tile=page.getByRole('button',{name:'Preview permit.pdf',exact:true});await tile.scrollIntoViewIfNeeded();await tile.locator('canvas').waitFor();await page.waitForFunction(()=>{const canvas=document.querySelector('button[aria-label="Preview permit.pdf"] canvas') as HTMLCanvasElement;if(!canvas?.width)return false;const pixel=canvas.getContext('2d')!.getImageData(40,55,1,1).data;return pixel[0]<100&&pixel[2]>150&&pixel[3]===255;});
 if(width===1440){const first=(await tile.boundingBox())!,second=(await page.getByRole('button',{name:'Preview containers.xlsx',exact:true}).boundingBox())!;assert.equal(first.y,second.y,'Attachments use multiple columns');}
 await tile.click();const dialog=page.getByRole('dialog',{name:'Attachment preview'});await dialog.getByText('Page 1 of 1',{exact:true}).waitFor();await dialog.locator('canvas').waitFor();await page.keyboard.press('Escape');
 await page.getByRole('button',{name:'Preview containers.xlsx',exact:true}).click();await dialog.getByRole('cell',{name:'TEST1234567',exact:true}).waitFor();await dialog.getByRole('cell',{name:'Approved',exact:true}).waitFor();await page.keyboard.press('Escape');
 await page.getByRole('button',{name:'Preview guide.docx',exact:true}).click();await dialog.frameLocator('iframe').getByText('Verified Word document preview',{exact:true}).waitFor();assert.equal(await dialog.locator('iframe').getAttribute('sandbox'),'');await page.keyboard.press('Escape');
 await page.getByRole('button',{name:'Preview legacy.doc',exact:true}).click();await dialog.getByText(/Preview unavailable for this format/).waitFor();await page.keyboard.press('Escape');
 await page.getByRole('button',{name:'Preview photo.png',exact:true}).click();await dialog.getByRole('img',{name:'photo.png',exact:true}).waitFor();await page.keyboard.press('Escape');
 assert.equal(reads.get('pdf'),1,'Thumbnail and viewer reuse the authenticated attachment request');assert.equal(reads.get('logo'),1);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'No horizontal page overflow');
 await page.screenshot({path:`test-results/auto-mail-attachments-${width}.png`,fullPage:true});assert.deepEqual(errors,[]);await page.close();
}console.log('Attachment previews passed: PDF canvas, XLSX cells, DOCX document, image, legacy fallback, inline logo, external-image opt-in, multi-column/mobile layout and cached reads.');}finally{await browser.close();}
