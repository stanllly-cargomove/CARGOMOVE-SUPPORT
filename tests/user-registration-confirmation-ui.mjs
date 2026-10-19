// Offline UI regression: all user mutations and company records are mocked.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
const require=createRequire(import.meta.url);
const css=(await Promise.all((await readdir('dist/assets')).filter(file=>file.endsWith('.css')).map(file=>readFile('dist/assets/'+file,'utf8')))).join('\n');

const fixtures = {
  auth: `export async function getExternalUserAccess(){return window.testUsers;} export async function updateExternalUserAccess(id,changes){window.testWrites.push({id,changes});const saved={...window.testUsers.find(u=>u.id===id),...changes};window.testUsers=window.testUsers.map(u=>u.id===id?saved:u);return saved;}`,
  storage: `export function getSubmissions(){return window.testSubmissions;} export function subscribeToStorage(){return ()=>{};}`,
  email: `export async function getEmailTemplateCatalog(){return {templates:[],ports:[]};} export async function generateWelcomeEmailPreview(){window.testPreviews++;return {};} export async function sendWelcomeEmail(){}`,
  notifications: `export function notifyError(message){window.testNotices.push(message);} export function notifySuccess(message){window.testNotices.push(message);}`,
};
const bundle = await build({
  absWorkingDir: process.cwd(), tsconfig: 'tsconfig.json',
  stdin: { contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {UserRegistration} from './src/components/admin/UserRegistration';createRoot(document.getElementById('root')).render(<div className="admin-theme admin-theme-dark"><UserRegistration/></div>);`, resolveDir: process.cwd(), loader: 'tsx' },
  bundle: true, write: false, format: 'iife', platform: 'browser',
  define: { 'process.env.NODE_ENV': '"test"' },
  plugins: [{ name: 'offline-services', setup(b) {
    b.onResolve({filter:/services\/(auth|storage|email)$|common\/notifications$/},args=>({path:args.path.split('/').at(-1),namespace:'fixture'}));
    b.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:fixtures[args.path],loader:'js'}));
    b.onResolve({filter:/.*/},args=>{
      const dir=args.resolveDir||process.cwd();
      if(args.path.startsWith('.')) {
        const base=resolve(dir,args.path);
        for(const suffix of ['', '.tsx', '.ts', '.js'])if(existsSync(base+suffix))return {path:base+suffix};
      }
      return {path:require.resolve(args.path,{paths:[dir]})};
    });
  }}],
});
const browser=await chromium.launch({channel:'chrome',headless:true});
try {
  for(const mode of ['pending-company','edit','registered','unlinked','rejected-company']) {
    const page=await browser.newPage({viewport:{width:mode==='edit'?390:1440,height:900}});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.setContent('<div id="root"></div>');
    await page.addStyleTag({content:css});
    await page.evaluate(mode=>{
      window.testUsers=[{id:'u1',username:'test-user',email:'user@example.test',password:'test-password',company_id:mode==='unlinked'?undefined:'c1',company_name:'Example Company',full_name:'Test User',mobile_number:'0123456789',status:'PENDING',email_status:'NOT_READY',email_sent:0,created_at:'2026-10-19',updated_at:'2026-10-19'}];
      window.testSubmissions=[{registration_type:'COMPANY',company_id:'c1',port_id:'westport',status:mode==='registered'?'DONE':mode==='rejected-company'?'REJECTED':'PENDING'}];
      window.testWrites=[];window.testNotices=[];window.testPreviews=0;
    },mode);
    await page.addScriptTag({content:bundle.outputFiles[0].text});
    await page.getByRole('heading',{name:'User Registration',exact:true}).waitFor();
    if(mode==='edit') {
      await page.getByRole('button',{name:'Edit test-user',exact:true}).click();
      const form=page.getByRole('dialog',{name:'Edit User Access'});
      await form.getByLabel('Full name',{exact:true}).fill('Updated User');
      await form.locator('select').selectOption('DONE');
      await form.getByRole('button',{name:'Save Changes'}).click();
    } else {
      await page.locator('tbody select').first().selectOption('DONE');
    }
    const warning=page.getByRole('alertdialog',{name:'Company registration not completed'});
    if(mode==='registered') {
      await page.waitForFunction(()=>window.testWrites.length===1);
      assert.equal(await warning.count(),0);
    } else {
      await warning.waitFor();
      assert.equal(await page.evaluate(()=>window.testWrites.length),0,'Unregistered companies must never allow a Done mutation');
      await warning.getByText(/Cannot mark.*Please complete the company registration first/).waitFor();
      assert.equal(await warning.getByRole('button').count(),1,'There must be no override button');
      await warning.getByRole('button',{name:'Close',exact:true}).click();
      assert.equal(await warning.count(),0);
      if(mode==='edit') {
        const form=page.getByRole('dialog',{name:'Edit User Access'});
        assert.equal(await form.getByLabel('Full name',{exact:true}).inputValue(),'Updated User');
        await form.getByRole('button',{name:'Save Changes'}).click();
        await warning.waitFor();
        assert.equal(await page.evaluate(()=>window.testWrites.length),0,'Retrying must still be blocked');
      } else {
        assert.equal(await page.locator('tbody select').first().inputValue(),'PENDING');
      }
      assert.equal(await page.evaluate(()=>window.testWrites.length),0);
      assert.equal(await page.evaluate(()=>window.testPreviews),0);
    }
    assert.deepEqual(errors,[]);console.log('Passed: '+mode);await page.close();
  }
} finally {await browser.close();}
