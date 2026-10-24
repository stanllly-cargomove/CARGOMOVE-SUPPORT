// Offline browser checks: no real Gmail, OpenAI, or database traffic.
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

const bundle = await build({ stdin: { contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {AutoEmailConfig} from './src/components/admin/AutoEmailConfig';import {AutoMailDrafts} from './src/components/admin/AutoMailDrafts';createRoot(document.getElementById('root')).render(<main className="p-4"><AutoEmailConfig onBack={()=>{}}/><AutoMailDrafts scope="test" connection="test" aiReady disabled={false} onResume={()=>{}} onAi={()=>{}} onDelete={()=>{}} onOpenThread={()=>{}}/></main>);`, resolveDir: process.cwd(), loader: 'tsx' }, bundle: true, write: false, format: 'iife', platform: 'browser', define: { 'process.env.NODE_ENV': '"test"' } });
const css = (await Promise.all((await readdir('dist/assets')).filter(file => file.endsWith('.css')).map(file => readFile('dist/assets/' + file, 'utf8')))).join('\n');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  for (const width of [360, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    let settings = { enabled: false, scope: 'ALL', version: 1, auto_reply_enabled: false, min_confidence: 0.95, max_auto_replies_per_hour: 5 };
    let writes = 0, settingsLoads = 0, conflict = false, server = true, migration = true;
    await page.route('**/*', route => {
      const url = new URL(route.request().url()); assert.equal(url.origin, 'http://auto.test');
      if (url.pathname === '/styles.css') return route.fulfill({ contentType: 'text/css', body: css });
      if (url.pathname.startsWith('/assets/')) return route.fulfill({ path: 'dist' + url.pathname });
      if (url.pathname === '/api/auto-mail/agent-settings') return route.fulfill({ json: { settings: { enabled: true, model: 'test-model', enabled_models: ['test-model'], version: 1 }, models: ['test-model'], storageReady: true, serverEnabled: true, keyConfigured: true } });
      if (url.pathname === '/api/auto-mail/incoming-settings') {
        if (route.request().method() === 'POST') {
          writes++; if (conflict) return route.fulfill({ status: 409, json: { error: 'Settings changed. Reload before saving.' } });
          const body = route.request().postDataJSON(); assert.equal(body.version, settings.version);
          settings = { ...body, version: settings.version + 1 }; return route.fulfill({ json: { settings } });
        }
        if (++settingsLoads === 1) return route.fulfill({ status: 404, contentType: 'text/html', body: 'Cannot GET /api/auto-mail/incoming-settings' });
        return route.fulfill({ json: { storageReady: true, autoReplyReady: migration, autoReplyServerEnabled: server, settings, worker: null } });
      }
      if (url.pathname === '/api/auto-mail/ai-drafts') return route.fulfill({ json: { nextOffset: null, drafts: ['SENDING', 'SENT', 'UNKNOWN', 'REVIEW'].map(state => ({ id: state, threadId: state, sourceMessageId: state, status: 'NEEDS_REVIEW', autoReplyState: state, body: 'Answer ' + state, createdAt: new Date().toISOString(), sources: [], scope: 'ALL' })), jobs: [{ id: 'job', subject: 'Automatic reply history', gmail_thread_id: 'thread', status: 'DRAFT_READY', auto_reply_state: 'SENT', classification: { category: 'SUPPORT_REQUEST', kb_match: 'STRONG', confidence: 0.99 }, auto_reply_evaluation: { confidence: 0.98, reason: 'Directly supported.' }, review_reason: '', created_at: new Date().toISOString() }] } });
      assert.equal(url.pathname, '/');
      return route.fulfill({ contentType: 'text/html', body: `<meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css"><div id="root"></div><script>${bundle.outputFiles[0].text}</script>` });
    });
    await page.goto('http://auto.test');
    await page.getByRole('alert').filter({ hasText: 'Incoming settings API is unavailable' }).waitFor();
    await page.locator('[data-ai-status="error"]').waitFor();
    await page.getByRole('button', { name: 'Refresh AI settings', exact: true }).click();
    await page.locator('[data-ai-status="ready"]').waitFor();
    const toggle = page.getByRole('checkbox', { name: 'Let AI send eligible replies automatically', exact: true });
    await toggle.waitFor(); assert.equal(await toggle.isChecked(), false); assert.equal(await toggle.isDisabled(), true);
    const drafts = page.getByRole('checkbox', { name: 'Automatically prepare drafts for incoming emails', exact: true });
    await drafts.check(); await toggle.check();
    const confidence = page.getByRole('spinbutton', { name: 'Minimum confidence (%)', exact: true });
    const cap = page.getByRole('spinbutton', { name: 'Maximum automatic replies per hour', exact: true });
    const save = page.getByRole('button', { name: 'Save incoming draft settings', exact: true });
    await confidence.fill('79'); assert.equal(await save.isDisabled(), true); assert.equal(writes, 0);
    await confidence.fill('97'); await cap.fill('3');
    conflict = true; await save.click(); await page.getByRole('alert').filter({ hasText: 'Settings changed' }).waitFor();
    assert.equal(await toggle.isChecked(), true); assert.equal(await confidence.inputValue(), '97');
    conflict = false; await save.click(); await page.getByText('Automatic replies are ON for eligible new incoming messages.', { exact: true }).waitFor();
    assert.equal(settings.auto_reply_enabled, true); assert.equal(settings.min_confidence, 0.97); assert.equal(settings.max_auto_replies_per_hour, 3);
    await drafts.uncheck(); assert.equal(await toggle.isChecked(), false); await save.click();
    await page.getByText('Automatic replies are OFF. Replies require staff review and Send.', { exact: true }).waitFor(); assert.equal(settings.auto_reply_enabled, false);
    server = false; await page.getByRole('button', { name: 'Refresh AI settings' }).click();
    await page.getByText('Automatic sending is disabled on the server.', { exact: false }).waitFor();
    await drafts.check(); assert.equal(await toggle.isDisabled(), true);
    page.once('dialog', dialog => void dialog.accept()); migration = false; await page.getByRole('button', { name: 'Refresh AI settings' }).click();
    await page.getByText('Automatic replies need database setup.', { exact: false }).waitFor(); assert.equal(await toggle.isDisabled(), true);
    await page.getByRole('tab', { name: 'By AI tools', exact: true }).click();
    const buttons = page.getByRole('button', { name: 'Review in conversation', exact: true }); await buttons.nth(3).waitFor();
    assert.equal(await buttons.nth(0).isDisabled(), true); assert.equal(await buttons.nth(1).isDisabled(), true); assert.equal(await buttons.nth(2).isDisabled(), true); assert.equal(await buttons.nth(3).isEnabled(), true);
    await page.locator('summary').filter({ hasText: 'Classification and issues' }).click();
    await page.getByText('Auto-reply: SENT.', { exact: false }).waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.deepEqual(errors, []); await page.close();
  }
  console.log('Auto-reply OFF/ON, thresholds, limits, conflicts, setup guidance and delivery history passed on desktop/mobile.');
} finally { await browser.close(); }
