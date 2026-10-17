// Offline approval/reprocess workflow. Run npm run build before this test.
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

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
    let approvals=0,uploads=0,schedulers=0,failScheduler=false;
    const order:string[]=[];
    await page.route('**/*',async route=>{
      const url=new URL(route.request().url());assert.equal(url.origin,'http://northport.test');
      if(url.pathname==='/api/dev-tools/northport-recovery') {
        if(route.request().method()==='GET')return route.fulfill({json:{history:[],uploadsEnabled:true,missingGates:[]}});
        const body=route.request().postDataJSON();
        if(body.action==='search')return route.fulfill({json:{matches:[{filename:'CM_CONTAINER_20261018005309_GP.csv',type:'GP',timestamp:'2026-10-18T00:53:09',record:2,values,token:'test-token'}],errors:[],complete:true,candidates:1,listed:1}});
        if(body.action==='approve'){approvals++;assert.equal(body.approved,true);return route.fulfill({json:{recovery:{id:'approved-'+approvals},preview:'UNIT,GPNO\r\nTIIU6785282,26101766773',uploadsEnabled:true}});}
        if(body.action==='upload'){uploads++;order.push('upload');return route.fulfill({json:{status:'Uploaded'}});}
        if(body.action==='scheduler'){schedulers++;order.push('scheduler');return failScheduler?route.fulfill({status:502,json:{message:'Scheduler request failed.'}}):route.fulfill({json:{status:'Scheduler Triggered',message:'Scheduler request sent successfully. Completion has not been verified.',executionId:'hidden-execution-id',processingResult:'Verification Unavailable'}});}
        throw new Error('Unexpected action '+body.action);
      }
      if(url.pathname==='/styles.css')return route.fulfill({contentType:'text/css',body:css});
      return route.fulfill({contentType:'text/html',body:`<meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css"><main style="padding:16px"><div id="root"></div></main><script>${bundle.outputFiles[0].text}</script>`});
    });
    await page.goto('http://northport.test');
    await page.getByLabel('Container No.',{exact:true}).fill(values[0]);
    await page.getByLabel('EIR time (Malaysia)',{exact:true}).fill('2026-10-18T00:53');
    await page.getByRole('button',{name:'Search FTP',exact:true}).click();
    const openReview=async()=>{
      if(width<768)await page.getByRole('button',{name:'Reprocess',exact:true}).click();
      else {await page.getByRole('button',{name:'Record actions',exact:true}).click();await page.getByRole('button',{name:'Reprocess',exact:true}).click();}
    };
    await openReview();
    const editor=page.getByRole('dialog',{name:'Container file editor',exact:true});
    assert.equal(await editor.getByRole('button',{name:'Close file editor',exact:true}).count(),0);
    const approve=editor.getByRole('button',{name:width<640?'Approve CSV':'Approve & Generate Recovery CSV',exact:true});
    await editor.locator('.northport-dialog-footer').scrollIntoViewIfNeeded();
    const reviewSize=await editor.boundingBox();
    const cancelBefore=await editor.getByRole('button',{name:'Cancel',exact:true}).boundingBox();
    await approve.click();
    const confirmation=page.getByRole('alertdialog');
    await confirmation.getByRole('button',{name:'Cancel',exact:true}).click();
    assert.equal(approvals,0,'Cancel approval must not make a request');
    await approve.click();
    await confirmation.getByRole('button',{name:'Approve',exact:true}).click();
    await editor.getByText('Approved · Ready to reprocess',{exact:true}).waitFor();
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
    const reprocess=editor.getByRole('button',{name:width<640?'Reprocess':'Reprocess & Run Scheduler',exact:true});
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
    await editor.getByText('Approved · Ready to reprocess',{exact:true}).waitFor();
    await reprocess.click();await confirmation.getByRole('button',{name:'Reprocess',exact:true}).click();
    await page.getByText(/Recovery File Uploaded, but the Northport scheduler was not confirmed:/).waitFor();
    assert.equal(await editor.isVisible(),true);
    assert.equal(await reprocess.isDisabled(),true,'Uncertain outcomes must block duplicate uploads');
    assert.equal(uploads,2);assert.equal(schedulers,2);assert.deepEqual(errors,[]);
    await page.close();console.log(`Approval/reprocess workflow passed at ${width}px`);
  }
} finally {await browser.close();}
