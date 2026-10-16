// Fully offline browser interaction test; every request is intercepted.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import { NORTHPORT_COLUMNS } from '../src/types/northport.js';
const bundle=await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {NorthportRecovery} from './src/components/admin/NorthportRecovery';createRoot(document.getElementById('root')).render(<NorthportRecovery onBack={()=>{}}/>);`,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,format:'iife',platform:'browser',define:{'process.env.NODE_ENV':'"test"'}});
const browser=await chromium.launch({headless:true});
try {
  const page=await browser.newPage({viewport:{width:390,height:844}});
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  const values=Array(20).fill('');values[0]='MSBU4179350';values[1]='000123';values[4]='I';
  const match={filename:'CM_CONTAINER_20261017012016_GP.csv',type:'GP',timestamp:'2026-10-17T01:20:16',record:1,values,token:'test-token'};
  let searches=0;let approvals=0;let uploads=0;let triggers=0;let noResults=false;
  let coverageWarning:string|null=null;
  let htmlFailure=false;
  let batchMode=false;
  let writesEnabled=false;let reprocessTest=false;let releaseUpload:(()=>void)|undefined;
  const writeOrder:string[]=[];
  let finish:(()=>void)|undefined;
  const history=[{id:'uploaded',container:'OTHER123',container_type:'EX',source_filename:'CM_CONTAINER_20261017012014_EX.csv',recovery_filename:'CM_CONTAINER_20261017012500_EX.csv',submitted_by:'admin@example.test',created_at:'2026-10-16T17:25:00Z',changed_fields:[],status:'Uploaded'}];
  await page.route('**/*',async route=>{
    const url=new URL(route.request().url());assert.equal(url.origin,'http://northport.test','External requests are forbidden');
    if(url.pathname==='/api/dev-tools/northport-recovery') {
      if(htmlFailure)return route.fulfill({status:404,contentType:'text/html',body:'<!DOCTYPE html><pre>Cannot GET /api/dev-tools/northport-recovery</pre>'});
      if(route.request().method()==='GET')return route.fulfill({json:{history,uploadsEnabled:writesEnabled,missingGates:writesEnabled?[]:['READONLY_VERIFIED']}});
      const body=route.request().postDataJSON();assert.equal(route.request().headers()['x-cargomove-confirm'],'northport-recovery');
      if(body.action==='search') {
        searches++;assert.equal(body.unit,'MSBU4179350');assert.equal(body.timestamp,'2026-10-17T01:20:00');
        await new Promise<void>(resolve=>{finish=resolve;});
        if(batchMode)return route.fulfill({json:{matches:[{...match,record:body.cursor?2:1}],errors:[],listed:0,candidates:1,complete:!!body.cursor,nextCursor:body.cursor?null:'test-continuation',scope:'window',listingMode:'timestamp-scan',progress:{checked:body.cursor?20:10,total:20,files:body.cursor?2:1,records:body.cursor?6:3}}});
        return route.fulfill({json:{matches:noResults?[]:body.sourceFilename?[match]:[match,{...match,record:2}],listed:body.sourceFilename?0:17,candidates:body.sourceFilename?1:2,errors:[],complete:!coverageWarning,coverageWarning,scope:body.sourceFilename?'file':'window',sourceFilename:body.sourceFilename||null}});
      }
      if(body.action==='approve') {
        approvals++;assert.equal(body.approved,true);assert.equal(body.identityConfirmed,!reprocessTest);assert.equal(body.values[0],reprocessTest?'MSBU4179350':'NEW123');assert.equal(body.values[1],'000123');assert.equal(body.values.length,20);
        return route.fulfill({json:{recovery:{id:'approved-'+approvals},preview:NORTHPORT_COLUMNS.join(',')+'\r\r\n'+body.values.join(',')+'\r\r\n'}});
      }
      if(body.action==='upload'){
        uploads++;assert.ok(writesEnabled&&reprocessTest,'Read-only UI must never upload');assert.equal(body.values[0],'MSBU4179350');assert.equal(body.values.length,20);assert.equal(body.approved,true);writeOrder.push('upload');
        await new Promise<void>(resolve=>{releaseUpload=resolve;});
        return route.fulfill({json:{status:'Uploaded',message:'Recovery File Uploaded.'}});
      }
      if(body.action==='scheduler'){
        triggers++;
        if(reprocessTest){writeOrder.push('scheduler');assert.deepEqual(Object.keys(body).sort(),['action','id']);return route.fulfill({json:{status:'Scheduler Triggered',message:'Existing Northport scheduler requested.',executionId:'existing-run',processingResult:'Verification Unavailable'}});}
        return route.fulfill({status:502,json:{status:'Verification Unavailable',message:'Scheduler failed; check audit.'}});
      }
      throw new Error('Unexpected operation '+body.action);
    }
    return route.fulfill({contentType:'text/html',body:`<div id="root"></div><script>${bundle.outputFiles[0].text}</script>`});
  });
  await page.goto('http://northport.test');
  await page.getByRole('heading',{name:'Northport Container Recovery',exact:true}).waitFor();
  await page.getByLabel('Container Number',{exact:true}).fill(' msbu4179350 ');
  assert.equal(await page.getByLabel('Container Number',{exact:true}).inputValue(),'MSBU4179350');
  await page.getByLabel('Port Generated Timestamp (Malaysia)',{exact:true}).fill('2026-10-17T01:20');
  await page.getByRole('button',{name:'Search FTP',exact:true}).click();
  while(!finish)await new Promise(resolve=>setTimeout(resolve,5));
  assert.equal(await page.getByRole('button',{name:'Search FTP',exact:true}).isDisabled(),true);assert.equal(searches,1);
  finish();finish=undefined;
  await page.getByRole('heading',{name:'Search Results',exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:'Edit Record',exact:true}).count(),2);
  assert.equal(await page.getByRole('heading',{name:/Edit Record —/}).count(),0,'Must not auto-select first match');
  await page.getByRole('button',{name:'View Details',exact:true}).first().click();
  assert.equal(await page.getByLabel('GPNO',{exact:true}).inputValue(),'000123');
  assert.equal(await page.getByLabel('GPNO',{exact:true}).getAttribute('readonly'),'');
  await page.getByRole('button',{name:'Edit Record',exact:true}).last().click();
  await page.getByLabel('BLNO',{exact:true}).fill('changed');
  await page.getByRole('button',{name:'Reset Changes',exact:true}).click();
  assert.equal(await page.getByLabel('BLNO',{exact:true}).inputValue(),'');
  await page.getByLabel('UNIT',{exact:true}).fill('NEW123');
  await page.getByRole('button',{name:'Review Record',exact:true}).click();
  const approve=page.getByRole('button',{name:'Approve & Generate Recovery CSV',exact:true});assert.equal(await approve.isDisabled(),true);
  await page.getByRole('checkbox').check();page.once('dialog',dialog=>dialog.accept());await approve.click();
  await page.getByText('Approved · CSV Preview',{exact:true}).waitFor();assert.equal(approvals,1);
  assert.equal(await page.getByRole('button',{name:'Upload Recovery CSV',exact:true}).isDisabled(),true);assert.equal(uploads,0);
  assert.equal(await page.getByRole('button',{name:'Reprocess & Run Scheduler',exact:true}).isDisabled(),true);
  await page.getByRole('button',{name:'Process Later',exact:true}).click();assert.equal(triggers,0);
  page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'Run Scheduler Now',exact:true}).click();
  await page.getByRole('alert').filter({hasText:'Scheduler failed'}).waitFor();assert.equal(triggers,1);
  noResults=true;await page.getByRole('button',{name:'Search FTP',exact:true}).click();
  while(!finish)await new Promise(resolve=>setTimeout(resolve,5));finish();
  finish=undefined;
  await page.getByText(/No matching container record was found within the selected timestamp range/).waitFor();
  coverageWarning='Server listings omit existing files.';
  await page.getByRole('button',{name:'Search FTP',exact:true}).click();
  while(!finish)await new Promise(resolve=>setTimeout(resolve,5));finish();finish=undefined;
  await page.getByRole('alert').filter({hasText:'Search incomplete:'}).waitFor();
  assert.equal(await page.getByText(/No matching container record was found within the selected timestamp range/).count(),0,'Incomplete listings must not claim authoritative absence');
  await page.getByText(/No matching record was returned by this incomplete search/).waitFor();
  await page.getByRole('button',{name:'Use exact filename (advanced)',exact:true}).click();
  await page.getByLabel('Exact Source Filename (optional)',{exact:true}).fill(match.filename);
  noResults=false;coverageWarning=null;
  await page.getByRole('button',{name:'Search FTP',exact:true}).click();
  while(!finish)await new Promise(resolve=>setTimeout(resolve,5));finish();finish=undefined;
  await page.getByText(`Searched only ${match.filename}. Other files in the time window were not searched.`,{exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:'Edit Record',exact:true}).count(),1);
  assert.equal(await page.getByRole('alert').filter({hasText:'Search incomplete:'}).count(),0);
  batchMode=true;
  await page.getByRole('button',{name:'Search by time range',exact:true}).click();
  await page.getByRole('button',{name:'Search FTP',exact:true}).click();
  while(!finish)await new Promise(resolve=>setTimeout(resolve,5));finish();finish=undefined;
  await page.getByRole('progressbar',{name:'Filename scan progress'}).waitFor();
  assert.equal(await page.getByRole('progressbar').getAttribute('value'),'10');
  assert.equal(await page.getByRole('button',{name:'Search FTP',exact:true}).isDisabled(),true);
  assert.equal(await page.getByLabel('Container Number',{exact:true}).isDisabled(),true);
  while(!finish)await new Promise(resolve=>setTimeout(resolve,5));finish();finish=undefined;
  await page.getByRole('button',{name:'Cancel Search',exact:true}).waitFor({state:'hidden'});
  assert.equal(await page.getByRole('progressbar').getAttribute('value'),'20');
  assert.equal(await page.getByRole('button',{name:'Edit Record',exact:true}).count(),2,'Matches from all batches must remain visible');
  await page.getByRole('button',{name:'Search FTP',exact:true}).click();
  while(!finish)await new Promise(resolve=>setTimeout(resolve,5));finish();finish=undefined;
  await page.getByRole('progressbar',{name:'Filename scan progress'}).waitFor();
  await page.getByRole('button',{name:'Cancel Search',exact:true}).click();
  await page.getByRole('alert').filter({hasText:'Search stopped before completion.'}).waitFor();
  await page.getByRole('button',{name:'Search FTP',exact:true}).waitFor({state:'visible'});
  assert.equal(await page.getByRole('button',{name:'Search FTP',exact:true}).isDisabled(),false);
  writesEnabled=true;reprocessTest=true;
  await page.getByRole('button',{name:'Refresh History',exact:true}).click();
  await page.getByText('Production uploads enabled. Each upload requires approval.',{exact:false}).waitFor();
  await page.getByRole('button',{name:'Reprocess',exact:true}).first().click();
  await page.getByRole('heading',{name:'Review & Approval — MSBU4179350',exact:true}).waitFor();
  page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'Approve & Generate Recovery CSV',exact:true}).click();
  await page.getByText('Approved · CSV Preview',{exact:true}).waitFor();assert.equal(uploads,0,'Approval must not upload automatically');
  page.once('dialog',dialog=>dialog.dismiss());await page.getByRole('button',{name:'Reprocess & Run Scheduler',exact:true}).click();assert.equal(uploads,0);
  page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'Reprocess & Run Scheduler',exact:true}).click();
  while(!releaseUpload)await new Promise(resolve=>setTimeout(resolve,5));
  assert.deepEqual(writeOrder,['upload']);assert.equal(triggers,1,'Scheduler must wait for upload confirmation');
  assert.equal(await page.getByRole('button',{name:'Reprocess',exact:true}).first().isDisabled(),true);
  releaseUpload();
  await page.getByRole('status').filter({hasText:'Northport scheduler triggered.'}).waitFor();
  assert.deepEqual(writeOrder,['upload','scheduler']);assert.equal(uploads,1);assert.equal(triggers,2);
  await page.getByRole('status').filter({hasText:'Import verification: Verification Unavailable'}).waitFor();
  htmlFailure=true;
  await page.getByRole('button',{name:'Refresh History',exact:true}).click();
  await page.getByRole('alert').filter({hasText:'Northport recovery API was not found.'}).waitFor();
  await page.getByRole('button',{name:'Search FTP',exact:true}).click();
  await page.getByRole('alert').filter({hasText:'Northport recovery API was not found.'}).first().waitFor();
  assert.equal(await page.getByText(/Unexpected token/).count(),0);
  assert.deepEqual(errors,[]);console.log('Northport browser workflow passed, including automatic multi-batch search, progress, retained matches, cancellation and HTML 404 handling.');
}finally{await browser.close();}
