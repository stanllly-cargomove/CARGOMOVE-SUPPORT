// Exercise the real portal navigation, settings and KB page with offline APIs.
import assert from 'node:assert/strict';
import { readFile, readdir, mkdir } from 'node:fs/promises';
import { basename } from 'node:path';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

const unrelated = ['AdminDashboard', 'CompanyMaster', 'SubmissionsList', 'PortDepotConfig', 'SchemaMappingInspector', 'GuidelineManager', 'UserRegistration', 'AdminUser', 'EmailTemplateManager', 'SystemVersion', 'CargoMoveScheduler', 'AccountSettings', 'NorthportRecovery'];
const bundle = await build({
  stdin: { contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {AdminLayout} from './src/components/admin/AdminLayout';createRoot(document.getElementById('root')).render(<AdminLayout user={{id:'admin',email:'admin@example.test',type:'ADMIN'}} onSwitchToCustomer={()=>{}} onRefreshData={async()=>{}} onLogout={()=>{}} onUserChange={()=>{}}/>);`, loader: 'tsx', resolveDir: process.cwd() },
  bundle: true, write: false, format: 'iife', platform: 'browser', define: { 'process.env.NODE_ENV': '"test"' },
  plugins: [{ name: 'offline-portal', setup(builder) {
    builder.onLoad({ filter: /[\\/]components[\\/].*\.tsx$/ }, args => {
      const name = basename(args.path, '.tsx');
      if (!unrelated.includes(name)) return;
      const extra = name === 'AccountSettings' ? 'export const profileRequest=async()=>null;export const ProfileAvatar=()=>null;' : '';
      return { contents: `import React from 'react';export function ${name}(){return <div>${name}</div>;} ${extra}`, loader: 'tsx' };
    });
    builder.onLoad({ filter: /[\\/]services[\\/]auth\.ts$/ }, () => ({ contents: 'export const getExternalUserAccess=async()=>[];export const subscribeToExternalUserAccess=()=>()=>{};' }));
    builder.onLoad({ filter: /[\\/]services[\\/]storage\.ts$/ }, () => ({ contents: 'export const getPorts=()=>[];export const getSubmissions=()=>[];export const subscribeToStorage=()=>()=>{};' }));
    builder.onLoad({ filter: /[\\/]services[\\/]supabaseAuth\.ts$/ }, () => ({ contents: 'export const browserSupabaseAuth=null;' }));
  } }],
});
const css = (await Promise.all((await readdir('dist/assets')).filter(file => file.endsWith('.css')).map(file => readFile('dist/assets/' + file, 'utf8')))).join('\n');
await mkdir('test-results', { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  for (const width of [390, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 1000 }, reducedMotion: 'reduce' });
    page.setDefaultTimeout(10000);
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    const article={id:'kb-1',title:'Registration documents',summary:'Prepare these documents before registration.',content:'Prepare your company certificate.',category:'Registration',port:'ALL',keywords:['registration'],status:'APPROVED',version:3,updated_at:'2026-10-23T10:00:00Z'};
    const suggestion={id:'review-1',version:1,status:'PENDING',reason:'MANUAL_REPLY',proposed_title:'Registration guidance',proposed_content:'Prepare your company certificate.',proposed_summary:'A reusable staff answer.',proposed_category:'Registration',proposed_port:'ALL',proposed_keywords:['registration'],review_note:'',created_at:'2026-10-23T10:00:00Z'};
    const listQueries:URL[]=[];
    let incoming={enabled:false,scope:'ALL',version:1};
    await page.route('**/*', route => {
      const url = new URL(route.request().url());
      assert.equal(url.origin, 'http://localhost:3000');
      if (url.pathname === '/styles.css') return route.fulfill({ contentType: 'text/css', body: css });
      if (url.pathname.startsWith('/assets/')) return route.fulfill({ path: 'dist' + url.pathname });
      if(url.pathname==='/api/auto-mail/incoming-settings'){if(route.request().method()==='POST'){const body=route.request().postDataJSON();assert.equal(body.enabled,true);assert.equal(body.scope,'NORTHPORT');incoming={...body,version:body.version+1};return route.fulfill({json:{settings:incoming}});}return route.fulfill({json:{storageReady:true,settings:incoming,worker:null}});}
      if (url.pathname === '/api/auto-mail/agent-settings') return route.fulfill({ json: { settings: { enabled: true, model: 'gpt-5.4-mini', enabled_models: ['gpt-5.4-mini'], version: 0 }, models: ['gpt-5.4-mini', 'gpt-4.1-mini'], storageReady: true, serverEnabled: true, keyConfigured: true } });
      if (url.pathname === '/api/auto-mail/status') return route.fulfill({ json: { state: 'READY', message: 'Database ready.', knowledgeReady: true, learningReady: true, mailboxConnected: false, oauthReady: true } });
      if (url.pathname === '/api/auto-mail/knowledge'){listQueries.push(url);return route.fulfill({ json: { articles: [article], total: 1 } });}
      if(url.pathname==='/api/auto-mail/knowledge-article')return route.fulfill({json:{article,revisions:[]}});
      if(url.pathname==='/api/auto-mail/outbox')return route.fulfill({json:{messages:[],nextOffset:null,workerReady:true}});
      if (url.pathname === '/api/auto-mail/learning'){listQueries.push(url);return route.fulfill({ json: { suggestions: [suggestion], total: 1 } });}
      if(url.pathname==='/api/auto-mail/learning-suggestion')return route.fulfill({json:{suggestion,events:[]}});
      assert.ok(!url.pathname.startsWith('/api/'), 'Unexpected API: ' + url.pathname);
      return route.fulfill({ contentType: 'text/html', body: `<meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css"><div id="root"></div><script>${bundle.outputFiles[0].text}</script>` });
    });
    await page.goto('http://localhost:3000/admin');
    async function nav(name: string) {
      const menu = page.getByRole('button', { name: 'Open navigation menu', exact: true });
      if (await menu.isVisible()) await menu.click();
      await page.getByRole('button', { name, exact: true }).click();
    }
    await nav('Open Developer');
    await nav('Dev Setting');
    await page.getByRole('button', { name: /Auto Email Config Configure AI models/ }).click();
    await page.getByRole('heading', { name: 'Auto Email Config', exact: true }).waitFor();
    await page.getByRole('heading', { name: 'AI model', exact: true }).waitFor();
    await page.getByRole('heading', { name: 'Incoming email', exact: true }).waitFor();
    assert.equal(await page.getByRole('tab').count(), 0, 'Settings is a dedicated page without KB or learning tabs');
    assert.equal(listQueries.length, 0, 'Settings does not load KB or learning queues');
    await page.screenshot({ path: `test-results/auto-email-config-${width}.png`, fullPage: true });
    await page.locator('main').getByRole('button', { name: 'Dev Setting', exact: true }).last().click();
    await page.getByRole('heading', { name: 'Developer Settings', exact: true }).waitFor();
    await nav('Return to Admin Portal');
    await nav('Auto Mail');
    assert.equal(await page.getByRole('tab').count(), 0, 'Configuration tabs are only in Developer settings');
    const folders=page.getByRole('navigation',{name:'Mail folders',exact:true});
    const breadcrumb=page.locator('header.sticky h1');
    for(const name of ['Sent','Drafts','Scheduled','Trash','Inbox']){
      await folders.getByRole('button',{name,exact:true}).click();
      await breadcrumb.locator('[aria-current="page"]').filter({hasText:new RegExp('^'+name+'$')}).waitFor();
    }
    await folders.getByRole('button',{name:'Knowledge Base',exact:true}).click();
    await page.getByRole('heading',{name:'Knowledge base',exact:true}).waitFor();
    assert.equal(await page.getByRole('heading',{name:'Auto Email Config',exact:true}).count(),0,'Knowledge opens in the mailbox');
    const table=page.getByRole('table',{name:'Knowledge base articles',exact:true});await table.waitFor();
    assert.deepEqual(await table.getByRole('columnheader').allTextContents(),['Article','Category','Scope','Status','Version','Updated','Action']);
    await table.getByRole('button',{name:'Registration documents',exact:true}).waitFor();
    const kbStatus=page.getByRole('combobox',{name:'Article status',exact:true});
    const addButton=page.getByRole('button',{name:'New article',exact:true});
    assert.ok(Math.abs((await kbStatus.boundingBox())!.y-(await addButton.boundingBox())!.y)<3,'Status and New article share a toolbar row');
    assert.ok((await page.getByRole('region',{name:'Knowledge base management',exact:true}).boundingBox())!.height>=360);
    assert.ok((await table.locator('tbody tr').first().boundingBox())!.height<56,'KB rows are compact');
    assert.equal(await page.getByRole('searchbox',{name:'Search emails'}).count(),0);
    const articleSearch=page.getByRole('searchbox',{name:'Search articles',exact:true});await articleSearch.waitFor();
    const articlePageSize=page.getByRole('combobox',{name:'Articles per page',exact:true});
    assert.deepEqual(await articlePageSize.locator('option').allTextContents(),['20 rows','30 rows','50 rows']);
    await Promise.all([page.waitForResponse(response=>response.url().includes('/knowledge?')&&new URL(response.url()).searchParams.get('pageSize')==='30'),articlePageSize.selectOption('30')]);
    await articleSearch.fill('registration');await Promise.all([page.waitForResponse(response=>response.url().includes('/knowledge?')&&new URL(response.url()).searchParams.get('q')==='registration'),articleSearch.press('Enter')]);
    assert.equal(listQueries.at(-1)?.searchParams.get('pageSize'),'30');
    await page.getByRole('button',{name:'Clear articles search',exact:true}).click();
    await articlePageSize.selectOption('20');
    assert.equal(await table.locator('tbody td').first().evaluate(element=>getComputedStyle(element).fontSize),'12px');
    const card=page.getByRole('region',{name:'Mail content',exact:true});
    assert.ok(Math.abs((await table.locator('..').boundingBox())!.width-(await card.boundingBox())!.width)<2,'Table viewport spans the main card width');
    const pageTitle=page.getByRole('heading',{name:'Knowledge base',exact:true});
    assert.equal(await card.getByRole('heading',{name:'Knowledge base',exact:true}).count(),0,'Workspace title is outside the card');
    assert.ok((await pageTitle.boundingBox())!.y<(await card.boundingBox())!.y);
    const previous=card.getByRole('button',{name:'Previous',exact:true});
    assert.ok(Math.abs((await card.boundingBox())!.y+(await card.boundingBox())!.height-((await previous.boundingBox())!.y+(await previous.boundingBox())!.height)-12)<3,'Pagination sits at the bottom of the card');
    assert.match(await breadcrumb.innerText(),/Tools \/ Auto Mail[\s\S]*Knowledge Base/);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'Wide table scrolls within its own card on mobile');
    await page.screenshot({path:`test-results/knowledge-base-table-${width}.png`,fullPage:true});
    await page.getByRole('button',{name:'New article',exact:true}).click();
    await breadcrumb.locator('[aria-current="page"]').filter({hasText:'Add'}).waitFor();
    assert.equal(await table.count(),0,'Add opens a separate editor view');
    assert.equal(await page.getByRole('button',{name:'Paste JSON',exact:true}).count(),0);
    const options=page.getByRole('button',{name:'Article options',exact:true});await options.click();
    const jsonMenu=page.getByRole('menu',{name:'Article options',exact:true});
    assert.deepEqual(await jsonMenu.getByRole('menuitem').allTextContents(),['Paste JSON','Copy JSON template']);
    await page.screenshot({path:`test-results/knowledge-base-add-options-${width}.png`,fullPage:true});
    await page.keyboard.press('ArrowDown');assert.equal(await page.getByRole('menuitem',{name:'Copy JSON template',exact:true}).evaluate(element=>element===document.activeElement),true);
    await page.keyboard.press('Escape');assert.equal(await options.evaluate(element=>element===document.activeElement),true);
    await page.getByRole('textbox',{name:'Article title',exact:true}).fill('Unsaved article');
    page.once('dialog',dialog=>dialog.dismiss());await page.getByRole('button',{name:'Back to Knowledge Base',exact:true}).click();
    assert.equal(await page.getByRole('textbox',{name:'Article title',exact:true}).inputValue(),'Unsaved article');
    page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'Back to Knowledge Base',exact:true}).click();await table.waitFor();
    await breadcrumb.locator('[aria-current="page"]').filter({hasText:'Knowledge Base'}).waitFor();
    await table.getByRole('button',{name:'Edit Registration documents',exact:true}).click();
    await breadcrumb.locator('[aria-current="page"]').filter({hasText:'Edit'}).waitFor();
    assert.equal(await page.getByRole('textbox',{name:'Article title',exact:true}).inputValue(),'Registration documents');
    await page.getByRole('button',{name:'Back to Knowledge Base',exact:true}).click();await table.waitFor();
    await folders.getByRole('button',{name:'Learning review',exact:true}).click();
    await page.getByRole('heading',{name:'Learning review',exact:true}).waitFor();
    const reviewTable=page.getByRole('table',{name:'Learning review suggestions',exact:true});await reviewTable.waitFor();
    assert.deepEqual(await reviewTable.getByRole('columnheader').allTextContents(),['Suggestion','Category','Scope','Source','Status','Created','Action']);
    await reviewTable.getByRole('button',{name:'Registration guidance',exact:true}).waitFor();
    assert.equal(await card.getByRole('heading',{name:'Learning review',exact:true}).count(),0);
    const suggestionSearch=page.getByRole('searchbox',{name:'Search suggestions',exact:true});await suggestionSearch.waitFor();
    const suggestionSize=page.getByRole('combobox',{name:'Suggestions per page',exact:true});await Promise.all([page.waitForResponse(response=>response.url().includes('/learning?')&&new URL(response.url()).searchParams.get('pageSize')==='50'),suggestionSize.selectOption('50')]);
    await suggestionSearch.fill('guidance');await Promise.all([page.waitForResponse(response=>response.url().includes('/learning?')&&new URL(response.url()).searchParams.get('q')==='guidance'),suggestionSearch.press('Enter')]);
    assert.equal(listQueries.at(-1)?.searchParams.get('pageSize'),'50');
    await page.getByRole('button',{name:'Clear suggestions search',exact:true}).click();
    const learningStatus=page.getByRole('combobox',{name:'Learning status',exact:true});
    assert.equal(await learningStatus.inputValue(),'','Learning defaults to All statuses');
    const refresh=page.getByRole('button',{name:'Refresh queue',exact:true});
    assert.equal(await refresh.innerText(),'','Refresh is an accessible icon button');
    assert.ok(Math.abs((await learningStatus.boundingBox())!.y-(await refresh.boundingBox())!.y)<3);
    assert.ok((await page.getByRole('region',{name:'Learning review queue',exact:true}).boundingBox())!.height>=360);
    assert.ok((await reviewTable.locator('tbody tr').first().boundingBox())!.height<56);
    assert.equal(await page.getByRole('searchbox',{name:'Search emails'}).count(),0);
    assert.equal(await reviewTable.locator('tbody td').first().evaluate(element=>getComputedStyle(element).fontSize),'12px');
    assert.ok(Math.abs((await reviewTable.locator('..').boundingBox())!.width-(await card.boundingBox())!.width)<2);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await page.screenshot({path:`test-results/learning-review-table-${width}.png`,fullPage:true});
    await reviewTable.getByRole('button',{name:'Review Registration guidance',exact:true}).click();
    await breadcrumb.locator('[aria-current="page"]').filter({hasText:/^Review$/}).waitFor();
    assert.equal(await reviewTable.count(),0);
    await page.getByRole('textbox',{name:'Article title',exact:true}).fill('Unsaved review title');
    page.once('dialog',dialog=>dialog.dismiss());await folders.getByRole('button',{name:'Learning review',exact:true}).click();
    assert.equal(await page.getByRole('textbox',{name:'Article title',exact:true}).inputValue(),'Unsaved review title');
    page.once('dialog',dialog=>dialog.accept());await folders.getByRole('button',{name:'Learning review',exact:true}).click();await reviewTable.waitFor();
    await breadcrumb.locator('[aria-current="page"]').filter({hasText:'Learning review'}).waitFor();
    await folders.getByRole('button',{name:'Inbox',exact:true}).click();
    await page.getByRole('button', { name: 'Auto Mail options', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Email config', exact: true }).click();
    await page.getByRole('heading', { name: 'AI model', exact: true }).waitFor();
    await page.getByRole('heading', { name: 'Incoming email', exact: true }).waitFor();
    assert.equal(await page.getByRole('tab').count(),0);
    await page.getByLabel('Automatically prepare drafts for incoming emails',{exact:true}).check();await page.getByRole('group',{name:'Authoritative KB scope',exact:true}).getByRole('checkbox',{name:'NORTHPORT',exact:true}).check();await page.getByRole('button',{name:'Save incoming draft settings',exact:true}).click();await page.getByText('Automatic replies are OFF. Replies require staff review and Send.',{exact:true}).waitFor();assert.equal(incoming.enabled,true);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    await page.screenshot({ path: `test-results/auto-email-agent-${width}.png`, fullPage: true });
    assert.deepEqual(errors, []);
    await page.close();
  }
  console.log('Real portal navigation: Auto Email Config contains model and automation settings, KB/Learning stay in Auto Mail, and settings open under Dev Setting from Auto Mail on desktop and mobile.');
} finally { await browser.close(); }
