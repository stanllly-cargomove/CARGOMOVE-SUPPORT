import { selectEirTime } from './northport-picker-helpers';
// Offline edit -> save -> approve -> countdown -> upload -> scheduler checks.
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import { NORTHPORT_COLUMNS } from '../src/types/northport';
import { prepareReprocessFile } from '../server-handlers/northport/format';

const bundle=await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {NorthportRecovery} from './src/components/admin/NorthportRecovery';createRoot(document.getElementById('root')).render(<NorthportRecovery onBack={()=>{}}/>);`,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,format:'iife',platform:'browser',define:{'process.env.NODE_ENV':'"test"'}});
const css=(await Promise.all((await readdir('dist/assets')).filter(file=>file.endsWith('.css')).map(file=>readFile(join('dist/assets',file),'utf8')))).join('\n');
const browser=await chromium.launch({channel:'chrome',headless:true});
try {
  for(const width of [390,1440]) {
    const page=await browser.newPage({viewport:{width,height:1000},reducedMotion:'reduce'});
    page.setDefaultTimeout(15000);
    await page.clock.install({time:new Date('2026-10-18T00:00:00Z')});
    const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
    page.on('dialog',()=>{throw new Error('Native confirmations are forbidden');});
    const values=Array(20).fill('');values[0]='TIIU6785282';
    const sibling=Array(20).fill('');sibling[0]='OTHER123';sibling[1]='000123';
    const original=Buffer.from(NORTHPORT_COLUMNS.join(',')+'\r\n'+sibling.join(',')+'\r\n'+values.join(',')+'\r\n');
    let downloads=0;
    let approvals=0,uploads=0,schedulers=0,editorLoads=0;
    let mode:'success'|'approval-failed'|'upload-failed'|'scheduler-failed'|'disabled'|'rate-limit'='success';
    let rateDenied=false;
    const order:string[]=[];
    await page.route('**/*',async route=>{
      const url=new URL(route.request().url());assert.equal(url.origin,'http://northport.test');
      if(url.pathname==='/api/dev-tools/northport-recovery') {
        if(route.request().method()==='GET')return route.fulfill({json:{history:[],uploadsEnabled:true,missingGates:[]}});
        const body=route.request().postDataJSON();
        if(body.action==='search')return route.fulfill({json:{matches:[{filename:'CM_CONTAINER_20261018005309_GP.csv',type:'GP',timestamp:'2026-10-18T00:53:09',record:2,totalRecords:2,values,token:'test-token'}],errors:[],complete:true,candidates:1,listed:1}});
        if(body.action==='editor-records'){editorLoads++;return route.fulfill({json:{filename:'CM_CONTAINER_20261018005309_GP.csv',rows:[sibling,values],editorToken:'editor-token'}});}
        if(body.action==='download-reprocess'){
          downloads++;assert.equal(body.sourceKind,'editor');assert.equal(body.record,2);
          return route.fulfill({contentType:'text/csv',body:prepareReprocessFile(original,body.record,[sibling,values][body.record-1],body.values).bytes});
        }
        if(body.action==='approve'){
          if(mode==='rate-limit'&&!rateDenied){rateDenied=true;return route.fulfill({status:429,json:{error:'Please wait a few seconds.'}});}
          approvals++;order.push('approve');assert.equal(body.approved,true);assert.equal(body.values[0],values[0]);
          if(mode==='approval-failed')return route.fulfill({status:503,json:{error:'Approval outcome unavailable. Check history.'}});
          return route.fulfill({json:{recovery:{id:'approved-'+approvals},uploadsEnabled:mode!=='disabled'}});
        }
        if(body.action==='upload'){
          uploads++;order.push('upload');assert.equal(body.id,'approved-'+approvals);
          return mode==='upload-failed'?route.fulfill({status:502,json:{error:'Upload outcome uncertain.'}}):route.fulfill({json:{status:'Uploaded'}});
        }
        if(body.action==='scheduler'){
          schedulers++;order.push('scheduler');assert.deepEqual(Object.keys(body).sort(),['action','id']);
          return mode==='scheduler-failed'?route.fulfill({status:502,json:{message:'Scheduler request failed.'}}):route.fulfill({json:{status:'Scheduler Triggered',executionId:'hidden-execution-id'}});
        }
        if(body.action==='verify-gp'){order.push('verify-gp');return route.fulfill({json:{status:'Pending Verification',message:'GP result not verified yet.'}});}
        if(body.action==='cancel')return route.fulfill({json:{status:'Cancelled',message:'Container recovery cancelled. No file was uploaded.'}});
        throw new Error('Unexpected action '+body.action);
      }
      if(url.pathname==='/styles.css')return route.fulfill({contentType:'text/css',body:css});
      return route.fulfill({contentType:'text/html',body:`<meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css"><main style="padding:16px"><div id="root"></div></main><script>${bundle.outputFiles[0].text}</script>`});
    });
    await page.goto('http://northport.test');
    await page.getByLabel('Container No.',{exact:true}).fill(values[0]);
    await selectEirTime(page,'2026-10-18T00:53');
    await page.getByRole('button',{name:'Search',exact:true}).click();
    const editor=page.getByRole('dialog',{name:'Container file editor',exact:true});
    const openEditor=async()=>{
      await page.getByRole('button',{name:'Record actions',exact:true}).click();
      await page.getByRole('button',{name:'Reprocess',exact:true}).click();
      await editor.getByRole('heading',{name:`View/Edit File — ${values[0]}`,exact:true}).waitFor();
    };
    await openEditor();
    const footer=editor.locator('.northport-dialog-footer');
    assert.deepEqual(await footer.locator(':scope > button').allTextContents(),['Cancel','Save Changes']);
    assert.equal(await editor.getByRole('button',{name:/Download CSV|Review Record/}).count(),0);
    const pagination=footer.getByRole('navigation',{name:'Container pages',exact:true});
    await page.waitForFunction(()=>!document.querySelector<HTMLButtonElement>('[aria-label="Previous container"]')?.disabled);
    if(width>=640)assert.equal(await pagination.getByRole('button',{name:'Container 2',exact:true}).getAttribute('aria-current'),'page');
    else assert.equal(await pagination.getByLabel('Container 2 of 2',{exact:true}).innerText(),'2/2');
    const navBox=await pagination.boundingBox(),footerBox=await footer.boundingBox();
    const cancelBox=await footer.getByRole('button',{name:'Cancel',exact:true}).boundingBox();
    assert.ok(navBox&&footerBox&&cancelBox&&Math.abs(navBox.x+navBox.width/2-footerBox.x-footerBox.width/2)<2,'Pagination is horizontally centered');
    assert.ok(navBox&&cancelBox&&Math.abs(navBox.y+navBox.height/2-cancelBox.y-cancelBox.height/2)<2,'Pagination and Cancel share one row');
    assert.equal(await editor.getByLabel('UNIT',{exact:true}).isEditable(),false);
    const waitForUnit=async(unit:string)=>page.waitForFunction(value=>{const inputs=document.querySelectorAll<HTMLInputElement>('[aria-label="UNIT"]');return inputs.length===1&&inputs[0].value===value;},unit);
    await pagination.getByRole('button',{name:'Previous container',exact:true}).click();await waitForUnit(sibling[0]);
    await editor.getByLabel('SRV',{exact:true}).fill('SIBLING DRAFT');
    await editor.getByLabel('FE',{exact:true}).fill('E');
    await pagination.getByRole('button',{name:'Next container',exact:true}).click();await waitForUnit(values[0]);
    await editor.getByLabel('SRV',{exact:true}).fill('EDITED');
    await pagination.getByRole('button',{name:'Previous container',exact:true}).click();await waitForUnit(sibling[0]);
    assert.equal(await editor.getByLabel('SRV',{exact:true}).inputValue(),'SIBLING DRAFT');
    await pagination.getByRole('button',{name:'Next container',exact:true}).click();await waitForUnit(values[0]);
    assert.equal(await editor.getByLabel('SRV',{exact:true}).inputValue(),'EDITED');assert.equal(editorLoads,1);
    const editorSize=await editor.boundingBox();
    await editor.getByRole('button',{name:'Save Changes',exact:true}).click();
    await editor.getByRole('heading',{name:'Approve and Process File',exact:true}).waitFor();
    const approvalSize=await editor.boundingBox();
    assert.ok(editorSize&&approvalSize&&Math.abs(editorSize.width-approvalSize.width)<1&&Math.abs(editorSize.height-approvalSize.height)<1&&Math.abs(editorSize.y-approvalSize.y)<1,'Editing and approval have identical size and position');
    assert.equal(approvals,0,'Saving drafts does not approve or send');
    assert.equal(await editor.getByRole('button',{name:'Cancel',exact:true}).count(),0);
    assert.equal(await editor.getByRole('button',{name:'Reset Changes',exact:true}).count(),0);
    await editor.getByText('1 field changed',{exact:true}).waitFor();
    await pagination.getByRole('button',{name:'Previous container',exact:true}).click();
    await editor.getByText('SIBLING DRAFT',{exact:true}).waitFor();
    await editor.getByText('2 fields changed',{exact:true}).waitFor();
    assert.equal(await editor.getByRole('heading',{name:'Approve and Process File',exact:true}).count(),1,'Approval pagination stays in the approval stage');
    await pagination.getByRole('button',{name:'Next container',exact:true}).click();
    await editor.getByText('EDITED',{exact:true}).waitFor();
    const downloadButton=editor.getByRole('button',{name:'Download CSV',exact:true});
    const downloadBounds=await downloadButton.boundingBox(),titleBounds=await editor.getByRole('heading',{name:'Approve and Process File',exact:true}).boundingBox();
    assert.ok(downloadBounds&&titleBounds&&Math.abs(downloadBounds.y-titleBounds.y)<2&&downloadBounds.x>titleBounds.x,'Download is at the top right beside the title');
    const download=page.waitForEvent('download');await downloadButton.click();
    const csv=await download;assert.equal(csv.suggestedFilename(),'REPROCESS_TIIU6785282.csv');
    const downloaded=await readFile((await csv.path())!);
    const edited=[...values];edited[4]='EDITED';
    assert.deepEqual(downloaded,prepareReprocessFile(original,2,values,edited).bytes);
    assert.equal(downloads,1);assert.equal(approvals,0);assert.equal(uploads,0);
    await page.waitForFunction(()=>!Array.from(document.querySelectorAll<HTMLButtonElement>('.northport-dialog-footer button')).find(button=>button.textContent==='Back')?.disabled);
    await editor.getByRole('button',{name:'Back',exact:true}).click();
    assert.equal((await editor.boundingBox())?.height,editorSize?.height,'Going Back preserves the dialog size');
    assert.equal(await editor.getByLabel('SRV',{exact:true}).inputValue(),'EDITED','Back restores the editor and its draft');
    const saveAndApprove=async()=>{
      await editor.getByRole('button',{name:'Save Changes',exact:true}).click();
      await editor.getByRole('button',{name:'Approve & Reprocess File',exact:true}).click();
    };
    const finishProcessing=async()=>{
      for(let tick=0;tick<10;tick++) {
        await new Promise(resolve=>setTimeout(resolve,80));
        if(await page.getByRole('button',{name:'Refresh History',exact:true}).isEnabled())return;
        await page.clock.fastForward(5500);
      }
      assert.fail('Recovery should complete its bounded requests');
    };
    await saveAndApprove();
    await editor.waitFor({state:'hidden'});
    await page.getByText(`${values[0]} recovery requested.`,{exact:true}).waitFor();
    assert.equal(await page.getByRole('alertdialog').count(),0,'No extra confirmation is needed');
    const processingHistory=page.locator(width<768?'.northport-history-cards':'.northport-history-table');
    await processingHistory.getByText('PROCESSING',{exact:true}).waitFor();
    await finishProcessing();
    assert.deepEqual(order,['approve','upload','scheduler','verify-gp']);
    assert.equal((await page.locator('body').innerText()).includes('hidden-execution-id'),false);
    for(const failure of ['approval-failed','upload-failed','scheduler-failed','disabled'] as const) {
      mode=failure;const beforeUploads=uploads,beforeSchedulers=schedulers;
      await openEditor();await saveAndApprove();await editor.waitFor({state:'hidden'});
      await finishProcessing();
      const snapshots=[approvals,uploads,schedulers];
      await page.clock.fastForward(12000);
      assert.deepEqual([approvals,uploads,schedulers],snapshots,'No automatic retries after a failed mutation');
      assert.equal(uploads,beforeUploads+(failure==='upload-failed'||failure==='scheduler-failed'?1:0));
      assert.equal(schedulers,beforeSchedulers+(failure==='scheduler-failed'?1:0));
    }
    mode='rate-limit';const beforeApprovals=approvals;
    await openEditor();await saveAndApprove();await editor.waitFor({state:'hidden'});
    await finishProcessing();assert.equal(approvals,beforeApprovals+1,'An admission denial may be retried once');
    mode='success';
    const beforeCancel=[approvals,uploads,schedulers];
    await openEditor();
    await editor.getByRole('button',{name:'Cancel',exact:true}).click();
    await editor.waitFor({state:'hidden'});
    await page.getByText('Container recovery cancelled. No file was uploaded.',{exact:true}).waitFor();
    assert.deepEqual([approvals,uploads,schedulers],beforeCancel,'Cancel never approves, uploads or dispatches');
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Footer fits the viewport');
    assert.deepEqual(errors,[]);
    await page.close();console.log(`Immediate popup close, requested notification, processing history, cancellation and failure safeguards passed at ${width}px`);
  }
} finally {await browser.close();}
