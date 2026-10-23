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
    builder.onLoad({ filter: /[\\/]services[\\/]storage\.ts$/ }, () => ({ contents: 'export const getSubmissions=()=>[];export const subscribeToStorage=()=>()=>{};' }));
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
    let incoming={enabled:false,scope:'ALL',version:1};
    await page.route('**/*', route => {
      const url = new URL(route.request().url());
      assert.equal(url.origin, 'http://localhost:3000');
      if (url.pathname === '/styles.css') return route.fulfill({ contentType: 'text/css', body: css });
      if (url.pathname.startsWith('/assets/')) return route.fulfill({ path: 'dist' + url.pathname });
      if(url.pathname==='/api/auto-mail/incoming-settings'){if(route.request().method()==='POST'){const body=route.request().postDataJSON();assert.equal(body.enabled,true);assert.equal(body.scope,'NORTHPORT');incoming={...body,version:body.version+1};return route.fulfill({json:{settings:incoming}});}return route.fulfill({json:{storageReady:true,settings:incoming,worker:null}});}
      if (url.pathname === '/api/auto-mail/agent-settings') return route.fulfill({ json: { settings: { enabled: true, model: 'gpt-5.4-mini', enabled_models: ['gpt-5.4-mini'], version: 0 }, models: ['gpt-5.4-mini', 'gpt-4.1-mini'], storageReady: true, serverEnabled: true, keyConfigured: true } });
      if (url.pathname === '/api/auto-mail/status') return route.fulfill({ json: { state: 'READY', message: 'Database ready.', knowledgeReady: true, learningReady: true, mailboxConnected: false, oauthReady: true } });
      if (url.pathname === '/api/auto-mail/knowledge') return route.fulfill({ json: { articles: [], total: 0 } });
      if (url.pathname === '/api/auto-mail/learning') return route.fulfill({ json: { suggestions: [], total: 0 } });
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
    await page.getByRole('button', { name: /Auto Email Config Manage the knowledge/ }).click();
    await page.getByRole('heading', { name: 'Auto Email Config', exact: true }).waitFor();
    await page.getByRole('button', { name: 'New article', exact: true }).waitFor();
    const knowledgeTab = page.getByRole('tab', { name: 'Knowledge Base', exact: true });
    const learningTab = page.getByRole('tab', { name: 'Learning review', exact: true });
    await knowledgeTab.focus(); await knowledgeTab.press('ArrowRight');
    assert.equal(await learningTab.getAttribute('aria-selected'), 'true');
    await page.getByRole('tabpanel', { name: 'Learning review', exact: true }).waitFor();
    await learningTab.press('Home');
    assert.equal(await knowledgeTab.getAttribute('aria-selected'), 'true');
    await page.screenshot({ path: `test-results/knowledge-base-developer-${width}.png` });
    await page.locator('main').getByRole('button', { name: 'Dev Setting', exact: true }).last().click();
    await page.getByRole('heading', { name: 'Developer Settings', exact: true }).waitFor();
    await nav('Return to Admin Portal');
    await nav('Auto Mail');
    assert.equal(await page.getByRole('tab').count(), 0, 'Configuration tabs are only in Developer settings');
    const folders=page.getByRole('navigation',{name:'Mail folders',exact:true});
    await folders.getByRole('button',{name:'Knowledge Base',exact:true}).click();
    await page.getByRole('heading',{name:'Knowledge base',exact:true}).waitFor();
    assert.equal(await page.getByRole('heading',{name:'Auto Email Config',exact:true}).count(),0,'Knowledge opens in the mailbox');
    await folders.getByRole('button',{name:'Learning review',exact:true}).click();
    await page.getByRole('heading',{name:'Learning review',exact:true}).waitFor();
    await folders.getByRole('button',{name:'Inbox',exact:true}).click();
    await page.getByRole('button', { name: 'Auto Mail options', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Email config', exact: true }).click();
    await page.getByRole('tab', { name: 'Email agent', exact: true }).waitFor();
    assert.equal(await page.getByRole('tab', { name: 'Email agent', exact: true }).getAttribute('aria-selected'), 'true');
    await page.getByRole('heading', { name: 'Email agent model', exact: true }).waitFor();
    await page.locator('summary').filter({hasText:'Automatic incoming drafts'}).click();await page.getByLabel('Automatically prepare drafts for incoming emails',{exact:true}).check();await page.getByLabel('Authoritative KB scope',{exact:true}).fill('NORTHPORT');await page.getByRole('button',{name:'Save incoming draft settings',exact:true}).click();await page.getByText('Incoming draft settings saved. Emails still require staff review and Send.',{exact:true}).waitFor();assert.equal(incoming.enabled,true);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    await page.screenshot({ path: `test-results/auto-email-agent-${width}.png`, fullPage: true });
    assert.deepEqual(errors, []);
    await page.close();
  }
  console.log('Real portal navigation: Auto Email Config contains KB and Learning tabs, supports keyboard navigation, and opens under Dev Setting from Auto Mail on desktop and mobile.');
} finally { await browser.close(); }
