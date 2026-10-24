// Offline smoke test: no FTP, scheduler or database requests leave the browser.
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

const bundle=await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {NorthportRecovery} from './src/components/admin/NorthportRecovery';createRoot(document.getElementById('root')).render(<NorthportRecovery onBack={()=>{}}/>);`,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,format:'iife',platform:'browser',define:{'process.env.NODE_ENV':'"test"'}});
const css=(await Promise.all((await readdir('dist/assets')).filter(name=>name.endsWith('.css')).map(name=>readFile('dist/assets/'+name,'utf8')))).join('\n');
const browser=await chromium.launch({channel:'chrome',headless:true});
try {
  const page=await browser.newPage({viewport:{width:1100,height:850}});
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  const history={id:'00000000-0000-4000-8000-000000000001',container:'MSBU4179350',container_type:'GP',source_filename:'CM_CONTAINER_20261017012016_GP.csv',recovery_filename:'',submitted_by:'admin@example.test',created_at:'2026-10-20T03:00:00Z',changed_fields:['BLNO'],status:'Approved',scheduler_status:null as string|null,gp_verification:null as any,search_setup:{unit:'MSBU4179350',timestamp:'2026-10-20T11:40:00',type:'ALL',before:7,after:12,sourceFilename:'',mode:'files'}};
  const actions:string[]=[];
  let previewHistory:any[]|null=null;
  const checkStatusTag=async(label:string,color:string)=>{
    const tag=page.locator('table .northport-history-status').filter({hasText:new RegExp(`^${label}$`)});
    const appearance=await tag.evaluate(element=>({width:element.getBoundingClientRect().width,height:element.getBoundingClientRect().height,background:getComputedStyle(element).backgroundColor,classes:element.className,icons:element.querySelectorAll("svg").length}));
    assert.deepEqual([appearance.width,appearance.height],[148,36],`${label} has the shared tag size`);
    assert.equal(appearance.background,color,`${label} has its reference background`);
    assert.ok(appearance.classes.includes('northport-history-status--'+label.toLowerCase()));assert.equal(appearance.icons,1);
  };
  const warning='Scheduler verification is not configured. Apply 20261021000000_scheduler_verification_30_seconds.sql.';
  let showWarning=true;
  await page.route('**/*',async route=>{
    const url=new URL(route.request().url());assert.equal(url.origin,'http://recovery.test');
    if(url.pathname==='/api/dev-tools/northport-recovery') {
      if(route.request().method()==='GET')return route.fulfill({json:{history:previewHistory||[history],manualReviewEnabled:true,historyWarning:showWarning?warning:undefined,uploadsEnabled:true,missingGates:[]}});
      const body=route.request().postDataJSON();actions.push(body.action);
      if(body.action==='search') {
        const retryRow=previewHistory?.find(row=>row.container===body.unit)||history;
        assert.equal(body.unit,retryRow.container);assert.equal(body.type,retryRow.container_type);assert.equal(body.timestamp,retryRow.search_setup.timestamp);assert.equal(body.before,7);assert.equal(body.after,12);assert.equal(body.mode,'files');
        return route.fulfill({json:{matches:[],scannedFiles:[],errors:[],complete:true,candidates:0,listed:0}});
      }
      if(body.action==='manual-review') {
        const row=previewHistory!.find(row=>row.id===body.id);
        assert.equal(body.expectedReviewId,row.manual_review?.id||null);
        row.manual_review={id:`10000000-0000-4000-8000-${String(actions.length).padStart(12,'0')}`,outcome:body.outcome,note:body.note,reviewedBy:'support@example.test',reviewedAt:'2026-10-21T02:00:00Z'};
        return route.fulfill({json:{status:body.outcome,manualReview:row.manual_review,message:'Manual status saved.'}});
      }
      if(body.action==='cancel-approved'){history.status='Cancelled';return route.fulfill({json:{status:'Cancelled',message:'Container recovery cancelled. No file was uploaded.'}});}
      if(body.action==='resume-approved')return route.fulfill({json:{id:history.id,token:'approved-source',approved:true,identityConfirmed:true,values:[history.container,...Array(19).fill('')]}});
      if(body.action==='upload'){history.status='Uploaded';history.recovery_filename='REPROCESS_MSBU4179350.csv';return route.fulfill({json:{status:'Uploaded'}});}
      if(body.action==='scheduler'){history.status='Scheduler Triggered';history.scheduler_status='trigger_requested';return route.fulfill({json:{status:'Scheduler Triggered'}});}
      if(body.action==='verify-gp'||body.action==='verify-result'){
        assert.deepEqual(Object.keys(body).sort(),['action','id']);
        const exportRow=previewHistory?.find(row=>row.id===body.id&&row.container_type==='EX');
        if(exportRow){exportRow.scheduler_run={last_run_verification:{status:'ADVANCED',before:'Yesterday at 11:59 PM',after:'Today at 12:01 AM',observedAt:'2026-10-21T00:02:00Z'}};return route.fulfill({json:{status:'Import Verified',message:'Export scheduler run verified.'}});}
        const matched=actions.filter(action=>action==='verify-gp'||action==='verify-result').length>1;
        history.gp_verification={status:matched?'VERIFIED':'NOT_FOUND',gatepass:'000123-GP',container:history.container,observedAt:'2026-10-20T03:01:00Z',updatedAt:matched?'2026-10-20T03:00:00Z':null,updatedWithinTolerance:matched?true:null,toleranceSeconds:120};
        if(matched)history.status='Import Verified';
        return route.fulfill({json:{status:matched?'Import Verified':'Pending Verification',message:matched?'Verified — GP found in CargoMove.':'GP pending verification.'}});
      }
      throw new Error('Unexpected operation '+body.action);
    }
    return route.fulfill({contentType:'text/html',body:`<style>${css}</style><div id="root"></div><script>${bundle.outputFiles[0].text}</script>`});
  });
  await page.goto('http://recovery.test');
  await page.getByText(warning,{exact:true}).waitFor();
  await page.getByRole('button',{name:history.container,exact:true}).click();
  const details=page.getByRole('dialog',{name:'Recovery details',exact:true});
  await details.getByRole('heading',{name:'Recovery progress'}).waitFor();
  assert.equal(await page.evaluate(()=>document.body.style.overflow),'hidden','Recovery details prevents background page scrolling');
  assert.equal(await page.evaluate(()=>document.documentElement.style.overflow),'','Recovery details leaves the root layout overflow unchanged');
  assert.equal(await details.getByText(/GP is done when/).count(),0);
  const detailsGrid=details.getByRole('heading',{name:'Files & approval',exact:true}).locator('..').locator('dl');
  assert.equal(await detailsGrid.evaluate(element=>getComputedStyle(element).gridTemplateColumns.split(' ').length),2);
  assert.equal(await details.locator('dt').first().evaluate(element=>getComputedStyle(element.nextElementSibling!).marginTop),'0px','File values sit closer to their labels');
  assert.equal(await details.getByRole('button',{name:'Close recovery details',exact:true}).count(),0,'Recovery popups have no header X button');
  for(const viewport of [{width:1100,height:850},{width:390,height:600}]) {
    await page.setViewportSize(viewport);
    const layout=await details.evaluate(dialog=>{
      const footer=dialog.querySelector('.northport-dialog-footer')!;
      const body=dialog.querySelector('.northport-dialog-body')!;
      body.scrollTop=body.scrollHeight;
      return {height:dialog.getBoundingClientRect().height,bottom:dialog.getBoundingClientRect().bottom,footerHeight:footer.getBoundingClientRect().height,footerPadding:getComputedStyle(footer).paddingBlock,footerBottom:footer.getBoundingClientRect().bottom,bodyBottom:body.getBoundingClientRect().bottom,footerTop:footer.getBoundingClientRect().top,allButtonsInFooter:[...dialog.querySelectorAll('button')].every(button=>footer.contains(button))};
    });
    assert.ok(Math.abs(layout.height-Math.min(viewport.height*0.92,640))<1,'Recovery details popup keeps its fixed responsive height');
    assert.equal(layout.footerPadding,'8px','Recovery details footer uses compact vertical padding');
    assert.ok(layout.footerHeight<=60,'Recovery details footer stays compact');
    assert.ok(layout.allButtonsInFooter,'Recovery actions are all in the bottom footer');
    assert.ok(Math.abs(layout.bottom-layout.footerBottom)<2,'Footer stays at the bottom of the popup');
    assert.ok(layout.bodyBottom<=layout.footerTop+1,'Scrolling content stays above the footer');
    await details.getByRole('heading',{name:'Recovery progress'}).click();
    assert.equal(await details.isVisible(),true,'Clicking inside keeps the popup open');
    await page.mouse.click(1,1);
    await details.waitFor({state:'hidden'});
    assert.notEqual(await page.evaluate(()=>document.body.style.overflow),'hidden','Background page scrolling is restored after the popup closes');
    await page.setViewportSize({width:1100,height:850});
    await page.getByRole('button',{name:history.container,exact:true}).click();
  }
  await page.setViewportSize({width:1100,height:850});
  await details.getByRole('button',{name:'Resume reprocessing',exact:true}).click();
  const confirmation=page.getByRole('alertdialog');
  await confirmation.getByRole('button',{name:'Cancel',exact:true}).click();
  await page.locator('table').getByText('CANCELLED',{exact:true}).waitFor();
  await checkStatusTag('CANCELLED','rgb(243, 244, 246)');
  assert.deepEqual(actions,['cancel-approved'],'Cancelling must record cancellation without preparing or uploading');
  // A separate approved attempt can later be resumed after cancellation.
  history.status='Approved';
  showWarning=false;
  await page.reload();
  assert.equal(await page.getByText(warning,{exact:true}).count(),0);
  await page.getByRole('button',{name:history.container,exact:true}).click();
  await details.getByRole('button',{name:'Resume reprocessing',exact:true}).click();
  await confirmation.getByRole('button',{name:'Upload & Reprocess',exact:true}).click();
  await details.waitFor({state:'hidden'});
  await page.getByText(`${history.container} recovery requested.`,{exact:true}).waitFor();
  await page.locator('table').getByText('PROCESSING',{exact:true}).waitFor();
  await checkStatusTag('PROCESSING','rgb(239, 246, 255)');
  await page.locator('table').getByText('FAIL',{exact:true}).waitFor({timeout:30000});
  await checkStatusTag('FAIL','rgb(254, 242, 242)');
  await page.getByRole('button',{name:history.container,exact:true}).click();
  assert.deepEqual(actions,['cancel-approved','resume-approved','upload','scheduler','verify-gp']);
  assert.equal(await details.getByRole('button',{name:'Resume reprocessing',exact:true}).count(),0);
  assert.equal(await details.getByRole('button',{name:'Run scheduler',exact:true}).count(),0);
  assert.match(await details.innerText(),/exact gatepass and container pair was not found/);
  assert.match(await details.innerText(),/Actual status/);
  assert.equal(await details.getByRole('button',{name:'Refresh status',exact:true}).count(),0);
  assert.equal(await details.getByRole('button',{name:'Check GP in CargoMove',exact:true}).count(),0);
  const failButtons=await details.locator('.border-t').last().getByRole('button').allTextContents();
  assert.deepEqual(failButtons.map(text=>text.trim()),['Close','Retry Recovery']);
  const closeBounds=await details.getByRole('button',{name:'Close',exact:true}).boundingBox();
  const retryBounds=await details.getByRole('button',{name:'Retry Recovery',exact:true}).boundingBox();
  assert.ok(closeBounds&&retryBounds&&closeBounds.x<retryBounds.x);
  await details.getByRole('button',{name:'Retry Recovery',exact:true}).click();
  await details.waitFor({state:'hidden'});
  await page.waitForFunction(()=>Array.from(document.querySelectorAll('button')).some(button=>button.textContent==='Refresh History'&&!button.disabled));
  assert.equal(await page.getByLabel('Container No.',{exact:true}).inputValue(),history.container);
  assert.deepEqual(actions,['cancel-approved','resume-approved','upload','scheduler','verify-gp','search'],'Retry repeats the search without uploading or dispatching');
  // A separate pending-check fixture exercises the shared GP verification button.
  history.gp_verification=null;
  await page.getByRole('button',{name:'Refresh History',exact:true}).click();
  await page.getByRole('button',{name:history.container,exact:true}).click();
  await details.getByRole('button',{name:'Check GP in CargoMove',exact:true}).click();
  await details.getByText('SUCCESS',{exact:true}).waitFor();
  await checkStatusTag('SUCCESS','rgb(236, 253, 245)');
  assert.deepEqual(actions,['cancel-approved','resume-approved','upload','scheduler','verify-gp','search','verify-result'],'Rechecking GP must not upload or request another scheduler run');
  assert.match(await details.innerText(),/000123-GP/);
  assert.match(await details.innerText(),/Within tolerance/);
  await page.setViewportSize({width:390,height:844});
  assert.equal(await detailsGrid.evaluate(element=>getComputedStyle(element).gridTemplateColumns.split(' ').length),2,'Mobile detail fields also use two columns');
  const mobileTag=await details.locator('.northport-history-status').boundingBox();
  assert.deepEqual([mobileTag?.width,mobileTag?.height],[148,36]);
  assert.equal(await details.evaluate(element=>element.scrollWidth<=element.clientWidth),true);
  await details.getByRole('button',{name:'Close',exact:true}).click();
  await page.setViewportSize({width:1440,height:1000});
  previewHistory=[
    {...history,id:'preview-success',container:'SUCCESS123'},
    {...history,id:'preview-processing',container:'PROCESS123',status:'Uploaded',scheduler_status:null,gp_verification:null},
    {...history,id:'preview-cancelled',container:'CANCEL123',status:'Cancelled',scheduler_status:null,gp_verification:null},
    {...history,id:'preview-fail',container:'FAIL123',status:'Failed',scheduler_status:null,gp_verification:null},
  ];
  await page.getByRole('button',{name:'Refresh History',exact:true}).click();
  await page.locator('table').getByText('SUCCESS123',{exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:'Run scheduler',exact:true,includeHidden:true}).count(),0,'Uploaded rows have no scheduler action on desktop or mobile');
  assert.equal(await page.getByRole('button',{name:'Process later',exact:true,includeHidden:true}).count(),0);
  for(const [label,color] of [['SUCCESS','rgb(236, 253, 245)'],['PROCESSING','rgb(239, 246, 255)'],['CANCELLED','rgb(243, 244, 246)'],['FAIL','rgb(254, 242, 242)']])await checkStatusTag(label,color);
  let sharedDetailsSize:{width:number;height:number}|null=null;
  for(const container of ['SUCCESS123','PROCESS123','CANCEL123','FAIL123']) {
    await page.getByRole('button',{name:container,exact:true}).click();
    assert.equal(await details.getByRole('button',{name:'Run scheduler',exact:true}).count(),0,'Recovery status details omit the scheduler action');
    const box=await details.boundingBox();assert.ok(box);
    const size={width:box.width,height:box.height};
    if(!sharedDetailsSize)sharedDetailsSize=size;else assert.deepEqual(size,sharedDetailsSize,`${container} uses the SUCCESS popup size`);
    assert.equal(await details.getByRole('button',{name:'Close recovery details',exact:true}).count(),0);
    if(container==='CANCEL123')assert.equal(await details.getByRole('button',{name:'Cancel recovery',exact:true}).count(),0,'Cancelled recovery has no cancel action');
    await details.getByRole('button',{name:'Close',exact:true}).click();
  }
  await page.locator('.northport-history-container').screenshot({path:'test-results/northport-history-design.png'});
  const beforeReview=[...actions];
  assert.equal(await page.locator('table').getByRole('button',{name:'Adjust recovery status',exact:true}).count(),0,'Adjustment controls only appear inside the popup');
  await page.getByRole('button',{name:'PROCESS123',exact:true}).click();
  const originalDetailsSize=await details.boundingBox();
  assert.equal(await details.getByLabel('Verification note',{exact:true}).isVisible(),false,'The full form stays hidden by default');
  const statusMenu=page.getByRole('dialog',{name:'Manual status adjustment',exact:true});
  const adjustButton=details.getByRole('button',{name:'Adjust recovery status',exact:true});
  assert.equal(await adjustButton.evaluate(button=>!!button.closest('.northport-dialog-footer')),true,'Status adjustment is in the bottom footer');
  await adjustButton.click();
  await statusMenu.waitFor();
  assert.equal(await statusMenu.locator('select').count(),0,'Status selection does not use an overflowing native dropdown');
  assert.equal(await statusMenu.getByRole('radio').count(),2);
  assert.deepEqual(await details.boundingBox(),originalDetailsSize,'Opening adjustment controls does not enlarge the details popup');
  await page.keyboard.press('Escape');
  await statusMenu.waitFor({state:'hidden'});
  assert.equal(await details.isVisible(),true,'Escape closes the adjustment menu while preserving the details popup');
  await adjustButton.click();
  await details.getByLabel('Verification note',{exact:true}).fill('Checked gatepass and container manually in CargoMove.');
  await details.getByRole('button',{name:'Save manual status',exact:true}).click();
  await details.locator('.northport-history-status').filter({hasText:'SUCCESS'}).waitFor();
  await details.getByText('support@example.test',{exact:true}).waitFor();
  assert.equal(await details.getByRole('button',{name:'Run scheduler',exact:true}).count(),0,'A manually successful recovery must not invite another scheduler request');
  await details.getByRole('button',{name:'Adjust recovery status',exact:true}).click();
  await statusMenu.getByRole('radio',{name:'FAIL',exact:true}).click();
  await details.getByLabel('Verification note',{exact:true}).fill('Corrected review: the gatepass number is different.');
  await details.getByRole('button',{name:'Save manual status',exact:true}).click();
  await details.locator('.northport-history-status').filter({hasText:'FAIL'}).waitFor();
  assert.deepEqual(actions,[...beforeReview,'manual-review','manual-review'],'Manual status changes never upload or dispatch');
  await page.setViewportSize({width:390,height:844});
  await details.getByRole('button',{name:'Adjust recovery status',exact:true}).click();
  const menuBounds=await statusMenu.boundingBox();
  assert.ok(menuBounds&&menuBounds.x>=0&&menuBounds.x+menuBounds.width<=390,'The adjustment menu fits a mobile viewport');
  await page.keyboard.press('Escape');
  assert.equal(await details.evaluate(element=>element.scrollWidth<=element.clientWidth),true);
  await details.getByRole('button',{name:'Close',exact:true}).click();
  await page.setViewportSize({width:1440,height:1000});
  const exportRow={...history,id:'preview-export',container:'EXPORT123',container_type:'EX',source_filename:'CM_CONTAINER_20261017012016_EX.csv',status:'Verification Unavailable',scheduler_status:'unknown',gp_verification:null,scheduler_run:null as any};
  previewHistory!.push(exportRow);
  await page.getByRole('button',{name:'Refresh History',exact:true}).click();
  await page.getByRole('button',{name:'EXPORT123',exact:true}).click();
  assert.equal(await details.getByRole('button',{name:'Check GP in CargoMove',exact:true}).count(),0);
  const beforeExport=[...actions];
  await details.getByRole('button',{name:'Check scheduler in CargoMove',exact:true}).click();
  await details.locator('.northport-history-status').filter({hasText:'SUCCESS'}).waitFor();
  await details.getByRole('button',{name:'Close',exact:true}).click();
  exportRow.scheduler_run.last_run_verification.status='UNCHANGED';exportRow.scheduler_status='trigger_requested';
  await page.getByRole('button',{name:'Refresh History',exact:true}).click();
  await page.getByRole('button',{name:'EXPORT123',exact:true}).click();
  assert.equal(await details.getByRole('button',{name:'Check scheduler in CargoMove',exact:true}).count(),0);
  await details.getByRole('button',{name:'Retry Recovery',exact:true}).click();
  await details.waitFor({state:'hidden'});
  await page.waitForFunction(()=>Array.from(document.querySelectorAll('button')).some(button=>button.textContent==='Refresh History'&&!button.disabled));
  assert.equal(await page.getByLabel('Container No.',{exact:true}).inputValue(),'EXPORT123');
  assert.deepEqual(actions,[...beforeExport,'verify-result','search'],'EX verification and retry do not upload or trigger a scheduler');
  assert.deepEqual(errors,[]);
  console.log('Recovery details layout, cancellation, resume ordering and status refresh passed.');
} finally {await browser.close();}
