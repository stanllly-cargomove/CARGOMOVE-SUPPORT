import { selectEirTime } from './northport-picker-helpers';
// Offline approval/reprocess workflow. Run npm run build before this test.
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import { NORTHPORT_COLUMNS } from '../src/types/northport.js';
import { prepareReprocessFile } from '../server-handlers/northport/format.js';

const bundle=await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {NorthportRecovery} from './src/components/admin/NorthportRecovery';createRoot(document.getElementById('root')).render(<NorthportRecovery onBack={()=>{}}/>);`,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,format:'iife',platform:'browser',define:{'process.env.NODE_ENV':'"test"'}});
const css=(await Promise.all((await readdir('dist/assets')).filter(file=>file.endsWith('.css')).map(file=>readFile(join('dist/assets',file),'utf8')))).join('\n');
const browser=await chromium.launch({channel:'chrome',headless:true});
try {
  for(const width of [390,1440]) {
    const page=await browser.newPage({viewport:{width,height:1000}});
    page.setDefaultTimeout(15000);
    const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
    page.on('dialog',()=>{throw new Error('Native browser confirmations are forbidden');});
    const values=Array(20).fill('');values[0]='TIIU6785282';
    const sibling=Array(20).fill('');sibling[0]='OTHER123';sibling[1]='000123';
    const original=Buffer.from(NORTHPORT_COLUMNS.join(',')+'\r\n'+sibling.join(',')+'\r\n'+values.join(',')+'\r\n');
    const edited=[...values];edited[4]='EDITED';
    const expected=prepareReprocessFile(original,2,values,edited).bytes;
    let draftDownloads=0;
    let approvals=0,uploads=0,schedulers=0,failScheduler=false;
    const order:string[]=[];
    await page.route('**/*',async route=>{
      const url=new URL(route.request().url());assert.equal(url.origin,'http://northport.test');
      if(url.pathname==='/api/dev-tools/northport-recovery') {
        if(route.request().method()==='GET')return route.fulfill({json:{history:[],uploadsEnabled:true,missingGates:[]}});
        const body=route.request().postDataJSON();
        if(body.action==='search')return route.fulfill({json:{matches:[{filename:'CM_CONTAINER_20261018005309_GP.csv',type:'GP',timestamp:'2026-10-18T00:53:09',record:2,totalRecords:2,values,token:'test-token'}],errors:[],complete:true,candidates:1,listed:1}});
        if(body.action==='download-reprocess'){draftDownloads++;assert.deepEqual(body.values,edited);return route.fulfill({contentType:'text/csv',body:prepareReprocessFile(original,2,values,body.values).bytes});}
        if(body.action==='approve'){approvals++;assert.equal(body.approved,true);assert.deepEqual(body.values,edited);return route.fulfill({json:{recovery:{id:'approved-'+approvals},preview:expected.toString('utf8'),filename:'REPROCESS_TIIU6785282.csv',records:2,uploadsEnabled:true}});}
        if(body.action==='upload'){uploads++;order.push('upload');return route.fulfill({json:{status:'Uploaded'}});}
        if(body.action==='scheduler'){schedulers++;order.push('scheduler');return failScheduler?route.fulfill({status:502,json:{message:'Scheduler request failed.'}}):route.fulfill({json:{status:'Scheduler Triggered',message:'Scheduler request sent successfully. Completion has not been verified.',executionId:'hidden-execution-id',processingResult:'Verification Unavailable'}});}
        throw new Error('Unexpected action '+body.action);
      }
      if(url.pathname==='/styles.css')return route.fulfill({contentType:'text/css',body:css});
      return route.fulfill({contentType:'text/html',body:`<meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css"><main style="padding:16px"><div id="root"></div></main><script>${bundle.outputFiles[0].text}</script>`});
    });
    await page.goto('http://northport.test');
    await page.getByLabel('Container No.',{exact:true}).fill(values[0]);
    await selectEirTime(page, '2026-10-18T00:53');
    await page.getByRole('button',{name:'Search FTP',exact:true}).click();
    await page.getByRole('button',{name:'Record actions',exact:true}).click();await page.getByRole('button',{name:'View/Edit File',exact:true}).click();
    const draftEditor=page.getByRole('dialog',{name:'Container file editor',exact:true});await draftEditor.getByLabel('SRV',{exact:true}).fill('EDITED');
    const draft=page.waitForEvent('download');await draftEditor.getByRole('button',{name:width<640?'Download':'Download CSV',exact:true}).click();const drafted=await draft;
    assert.equal(drafted.suggestedFilename(),'REPROCESS_TIIU6785282.csv');assert.deepEqual(await readFile((await drafted.path())!),expected);assert.equal(draftDownloads,1);assert.equal(approvals,0);assert.equal(uploads,0);
    await draftEditor.getByRole('button',{name:width<640?'Save':'Save Changes',exact:true}).click();await draftEditor.getByRole('button',{name:'Cancel',exact:true}).click();
    const openReview=async()=>{
      await page.getByRole('button',{name:'Record actions',exact:true}).click();await page.getByRole('button',{name:'Reprocess',exact:true}).click();
    };
    await openReview();
    const editor=page.getByRole('dialog',{name:'Container file editor',exact:true});
    const reprocessLabel=width<640?'Reprocess':'Reprocess & Run Scheduler';
    const waitForReprocess=async()=>page.waitForFunction(label=>Array.from(document.querySelectorAll<HTMLButtonElement>('.northport-dialog-footer button')).some(button=>button.innerText.trim().toLowerCase().startsWith(label.toLowerCase())&&!button.disabled),reprocessLabel);
    assert.equal(await editor.getByRole('button',{name:'Close file editor',exact:true}).count(),0);
    const approve=editor.getByRole('button',{name:width<640?'Approve CSV':'Approve Reprocess File',exact:true});
    await editor.locator('.northport-dialog-footer').scrollIntoViewIfNeeded();
    const reviewSize=await editor.boundingBox();
    const cancelBefore=await editor.getByRole('button',{name:'Cancel',exact:true}).boundingBox();
    await approve.click();
    const confirmation=page.getByRole('alertdialog');
    await confirmation.getByText(/All 2 records are included/).waitFor();
    await confirmation.getByRole('button',{name:'Cancel',exact:true}).click();
    assert.equal(approvals,0,'Cancel approval must not make a request');
    await approve.click();
    await confirmation.getByRole('button',{name:'Approve',exact:true}).click();
    await editor.getByText(/Approved · (Ready to reprocess|Ready in \d+s)/).waitFor();
    const approvedExport=page.waitForEvent('download');await editor.getByRole('button',{name:'Export CSV',exact:true}).click();const exported=await approvedExport;
    assert.equal(exported.suggestedFilename(),'REPROCESS_TIIU6785282.csv');assert.deepEqual(await readFile((await exported.path())!),expected);assert.equal(uploads,0);
    await editor.getByRole('heading',{name:`Reprocess File — ${values[0]}`,exact:true}).waitFor();
    const approvedSize=await editor.boundingBox();
    assert.ok(reviewSize&&approvedSize&&Math.abs(reviewSize.height-approvedSize.height)<1&&Math.abs(reviewSize.y-approvedSize.y)<1,'Approval must preserve the review size and position');
    const cancelAfter=await editor.getByRole('button',{name:'Cancel',exact:true}).boundingBox();
    assert.ok(cancelBefore&&cancelAfter&&Math.abs(cancelBefore.y-cancelAfter.y)<1&&Math.abs(cancelBefore.x-cancelAfter.x)<1,`Cancel must stay in the same position after approval: ${JSON.stringify({cancelBefore,cancelAfter,scroll:await editor.locator('.northport-dialog-body').evaluate(body=>body.scrollTop)})}`);
    if(width>=768){
      const box=await editor.boundingBox(),footer=await editor.locator('.northport-dialog-footer').boundingBox();
      assert.ok(box&&footer&&box.y+box.height-(footer.y+footer.height)<=24,'Reprocess dialog must end directly below its footer');
      await page.screenshot({path:join(tmpdir(),'northport-reprocess-compact.png')});
    }
    assert.equal(await editor.locator('pre').count(),0,'Raw CSV preview must be removed');
    const reprocess=editor.getByRole('button',{name:new RegExp(`^${reprocessLabel}`)});
    assert.equal(await reprocess.isDisabled(),true,'Reprocess observes the server cooldown after approval');
    assert.match(await reprocess.innerText(),/\(\d+s\)$/i,'The disabled button shows the remaining cooldown');
    await waitForReprocess();
    const color=await reprocess.evaluate(button=>getComputedStyle(button).backgroundColor);
    const cancelColor=await editor.getByRole('button',{name:'Cancel',exact:true}).evaluate(button=>getComputedStyle(button).color);
    assert.notEqual(color,cancelColor,'Reprocess and cancel must have distinct styling');
    await reprocess.click();
    await confirmation.getByRole('button',{name:'Cancel',exact:true}).click();
    assert.equal(uploads,0,'Cancel reprocess must not upload');
    await reprocess.click();
    await confirmation.getByRole('button',{name:'Reprocess',exact:true}).click();
    await editor.waitFor({state:'hidden'});
    await page.getByText('Recovery file uploaded. Northport processing requested successfully.',{exact:true}).waitFor();
    assert.deepEqual(order,['upload','scheduler']);assert.equal(uploads,1);assert.equal(schedulers,1);
    assert.equal((await page.locator('body').innerText()).includes('hidden-execution-id'),false);
    // A failed scheduler request must preserve the dialog and block another upload.
    failScheduler=true;
    await openReview();await approve.click();await confirmation.getByRole('button',{name:'Approve',exact:true}).click();
    await editor.getByText(/Approved · (Ready to reprocess|Ready in \d+s)/).waitFor();
    await waitForReprocess();
    await reprocess.click();await confirmation.getByRole('button',{name:'Reprocess',exact:true}).click();
    await page.getByText(/Recovery File Uploaded, but the Northport scheduler was not confirmed:/).waitFor();
    assert.equal(await editor.isVisible(),true);
    assert.equal(await reprocess.isDisabled(),true,'Uncertain outcomes must block duplicate uploads');
    assert.equal(uploads,2);assert.equal(schedulers,2);assert.deepEqual(errors,[]);
    await page.close();console.log(`Approval/reprocess workflow passed at ${width}px`);
  }
} finally {await browser.close();}
