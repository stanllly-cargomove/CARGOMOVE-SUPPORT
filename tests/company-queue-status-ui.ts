// Offline queue colors/tooltips and status tags. No live database or mailbox access.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFile, readdir } from 'node:fs/promises';
import { chromium } from 'playwright-core';

const companies = ['PENDING', 'REJECTED', 'DONE'].map(status => ({ id: status, name: `${status} carrier`, registration_status: status,
  company_type: 'HAULAGE', haulier_id: 'fixture-external-id', registration_number: status }));
const submissions = ['PENDING', 'DONE', 'REJECTED'].flatMap(status => ['DRIVER', 'TRAILER', 'VEHICLE', 'COMPANY'].flatMap(type => companies.map(company => ({
  id: `${status}-${type}-${company.id}`, reference_no: `${status}-${type}-${company.id}`, registration_type: type, company_id: company.id,
  company_name: company.name, company_type: 'HAULAGE', company_reg_no: company.id, port_location: 'JOHOR', port_id: 'fixture', status,
  submitted_at: '2026-10-25T00:00:00Z', data: {},
})))).filter(sub => sub.registration_type !== 'COMPANY');
// A Company tab must remain uncolored; this record belongs to another company and cannot affect asset approval.
submissions.push({ ...submissions[0], id: 'company-only', reference_no: 'company-only', registration_type: 'COMPANY', company_id: 'other-company' });
const bundle = await build({ stdin: { loader: 'tsx', resolveDir: process.cwd(), contents: `
  import React,{useState,useEffect}from'react';import{createRoot}from'react-dom/client';
  import{SubmissionsList}from'./src/components/admin/SubmissionsList';import{StatusBadge}from'./src/components/common/Badge';
  import{startProtectedStorageSync,subscribeToStorage}from'./src/services/storage';
  function App(){const[status,setStatus]=useState('PENDING'),[,tick]=useState(0);useEffect(()=>{const off=subscribeToStorage(()=>tick(n=>n+1));const stop=startProtectedStorageSync();return()=>{off();stop();}},[]);
    return <><button onClick={()=>setStatus('PENDING')}>Pending fixture</button><button onClick={()=>setStatus('DONE')}>Done fixture</button><button onClick={()=>setStatus('REJECTED')}>Rejected fixture</button>
      <aside aria-label="Status sizes"><StatusBadge status="PENDING"/><StatusBadge status="REGISTERED"/><StatusBadge status="REJECTED"/></aside>
      <SubmissionsList status={status} initialType="DRIVER"/></>;}
  createRoot(document.getElementById('root')).render(<App/>);` }, bundle: true, write: false, format: 'iife', platform: 'browser', define: { 'process.env.NODE_ENV': '"test"' } });
const css = (await Promise.all((await readdir('dist/assets')).filter(file => file.endsWith('.css')).map(file => readFile(`dist/assets/${file}`, 'utf8')))).join('\n');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  for (const width of [390, 1280]) {
    const page = await browser.newPage({ viewport: { width, height: 950 } });
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => {
      const url = new URL(route.request().url()); assert.equal(url.origin, 'http://queue-status.test');
      if (url.pathname === '/api/snapshot') return route.fulfill({ json: { companies, submissions, ports: [], depots: [], userRegistrations: [], guideline: null } });
      if (url.pathname === '/api/external-user-access') return route.fulfill({ json: { users: [] } });
      if (url.pathname.startsWith('/api/')) { errors.push(url.pathname); return route.fulfill({ status: 500, json: {} }); }
      return route.fulfill({ contentType: 'text/html', body: `<style>${css}</style><div id="root"></div><script>${bundle.outputFiles[0].text}</script>` });
    });
    await page.goto('http://queue-status.test');
    const name = (text: string) => page.locator('.admin-registration-copy-text').filter({ hasText: text }).filter({ visible: true });
    await name('PENDING CARRIER').waitFor();
    for (const tab of ['Driver', 'Trailer', 'Vehicle']) {
      await page.getByRole('tab', { name: new RegExp(`^${tab}`) }).click();
      for (const [text, color, message] of [['PENDING CARRIER', 'text-orange-600', 'company is not registered yet'], ['REJECTED CARRIER', 'text-red-600', 'company registration rejected']]) {
        const node = name(text);
        assert.equal(await node.evaluate((element, cls) => element.classList.contains(cls), color), true);
        await node.hover(); await page.getByRole('tooltip').getByText(message, { exact: true }).waitFor();
        await page.waitForFunction(element => getComputedStyle(element).color === 'rgb(37, 99, 235)', await node.elementHandle());
        await page.mouse.move(0, 0); await page.getByRole('tooltip').waitFor({ state: 'hidden' });
      }
      assert.equal(await name('DONE CARRIER').evaluate(element => element.classList.contains('text-slate-900')), true);
      for (const [parent, blocked] of [['PENDING', true], ['DONE', false]] as const) {
        const actions = page.getByRole('button', { name: `Actions for PENDING-${tab.toUpperCase()}-${parent}`, exact: true }).filter({ visible: true });
        await actions.click();
        assert.equal(await page.getByRole('button', { name: 'Register', exact: true }).isDisabled(), blocked);
        await actions.click();
      }
    }
    for (const view of ['Done fixture', 'Rejected fixture']) {
      await page.getByRole('button', { name: view, exact: true }).click();
      await name('PENDING CARRIER').waitFor();
      assert.equal(await name('PENDING CARRIER').evaluate(element => element.classList.contains('text-slate-900')), true);
      await name('PENDING CARRIER').hover(); assert.equal(await page.getByRole('tooltip').count(), 0);
    }
    await page.getByRole('button', { name: 'Pending fixture', exact: true }).click();
    await page.getByRole('tab', { name: /^Company/ }).click();
    await name('PENDING CARRIER').waitFor();
    assert.equal(await name('PENDING CARRIER').evaluate(element => element.classList.contains('text-slate-900')), true);
    const tags = await page.getByLabel('Status sizes').locator('span').evaluateAll(nodes => nodes.map(node => ({
      width: node.getBoundingClientRect().width, height: node.getBoundingClientRect().height, transform: getComputedStyle(node).textTransform,
    })));
    assert.equal(new Set(tags.map(tag => `${tag.width}:${tag.height}`)).size, 1); assert.ok(tags.every(tag => tag.transform === 'uppercase'));
    assert.deepEqual(errors, []); await page.close();
  }
  console.log('Pending asset company colors, tooltips, preserved blue hover, unchanged other queues and equal uppercase status tags passed at mobile/desktop widths.');
} finally { await browser.close(); }
