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
  const history={id:'00000000-0000-4000-8000-000000000001',container:'MSBU4179350',container_type:'GP',source_filename:'CM_CONTAINER_20261017012016_GP.csv',recovery_filename:'',submitted_by:'admin@example.test',created_at:'2026-10-20T03:00:00Z',changed_fields:['BLNO'],status:'Approved',scheduler_status:null as string|null};
  const actions:string[]=[];
  await page.route('**/*',async route=>{
    const url=new URL(route.request().url());assert.equal(url.origin,'http://recovery.test');
    if(url.pathname==='/api/dev-tools/northport-recovery') {
      if(route.request().method()==='GET')return route.fulfill({json:{history:[history],uploadsEnabled:true,missingGates:[]}});
      const body=route.request().postDataJSON();actions.push(body.action);
      if(body.action==='resume-approved')return route.fulfill({json:{id:history.id,token:'approved-source',approved:true,identityConfirmed:true,values:[history.container,...Array(19).fill('')]}});
      if(body.action==='upload'){history.status='Uploaded';history.recovery_filename='REPROCESS_MSBU4179350.csv';return route.fulfill({json:{status:'Uploaded'}});}
      if(body.action==='scheduler'){history.status='Scheduler Triggered';history.scheduler_status='trigger_requested';return route.fulfill({json:{status:'Scheduler Triggered'}});}
      throw new Error('Unexpected operation '+body.action);
    }
    return route.fulfill({contentType:'text/html',body:`<style>${css}</style><div id="root"></div><script>${bundle.outputFiles[0].text}</script>`});
  });
  await page.goto('http://recovery.test');
  await page.getByRole('button',{name:history.container,exact:true}).click();
  const details=page.getByRole('dialog',{name:'Recovery details',exact:true});
  await details.getByRole('heading',{name:'Recovery progress'}).waitFor();
  await details.getByRole('button',{name:'Resume reprocessing',exact:true}).click();
  const confirmation=page.getByRole('alertdialog');
  await confirmation.getByRole('button',{name:'Cancel',exact:true}).click();
  assert.deepEqual(actions,[],'Cancelling must not prepare or upload');
  await details.getByRole('button',{name:'Resume reprocessing',exact:true}).click();
  await confirmation.getByRole('button',{name:'Upload & Reprocess',exact:true}).click();
  await details.getByText('PROCESSING REQUESTED',{exact:true}).waitFor({timeout:20000});
  assert.deepEqual(actions,['resume-approved','upload','scheduler']);
  assert.equal(await details.getByRole('button',{name:'Resume reprocessing',exact:true}).count(),0);
  assert.equal(await details.getByRole('button',{name:'Run scheduler',exact:true}).count(),0);
  assert.match(await details.innerText(),/Container import is not yet verified/);
  await page.setViewportSize({width:390,height:844});
  assert.equal(await details.evaluate(element=>element.scrollWidth<=element.clientWidth),true);
  assert.deepEqual(errors,[]);
  console.log('Recovery details layout, cancellation, resume ordering and status refresh passed.');
} finally {await browser.close();}
