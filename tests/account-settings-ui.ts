// Offline interaction checks: no credentials or real uploads are used.
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

const bundle = await build({ stdin: { contents: `import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {AccountSettings,ProfileAvatar} from './src/components/admin/AccountSettings';import {NorthportDateTimePicker,NorthportTimeRangePicker} from './src/components/admin/NorthportDateTimePicker';function App(){const [url,setUrl]=useState(null);const [time,setTime]=useState('2026-10-20T13:10:00');const [range,setRange]=useState(10);return <main className="p-4"><AccountSettings user={{id:'account',email:'admin@example.test',full_name:'Test Admin',type:'ADMIN'}} avatarUrl={url} onAvatarChange={setUrl} onReset={()=>{}} sendingReset={false}/><ProfileAvatar url={url} name="Shared account avatar" className="h-8 w-8"/><div className="mt-6 w-64"><NorthportDateTimePicker value={time} disabled={false} onChange={setTime}/><NorthportTimeRangePicker direction="before" value={range} disabled={false} onChange={setRange}/></div><div style={{height:1500}}/></main>}createRoot(document.getElementById('root')).render(<App/>);`, resolveDir: process.cwd(), loader: 'tsx' }, bundle: true, write: false, format: 'iife', platform: 'browser', define: { 'process.env.NODE_ENV': '"test"' } });
const css = (await Promise.all((await readdir('dist/assets')).filter(file => file.endsWith('.css')).map(file => readFile(join('dist/assets', file), 'utf8')))).join('\n');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  for (const width of [320, 360, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    let uploads = 0, deletes = 0, fail = false;
    await page.route('**/*', async route => {
      const url = new URL(route.request().url());
      assert.equal(url.origin, 'http://account.test');
      if (url.pathname === '/api/auth/profile') {
        if (route.request().method() === 'DELETE') { deletes++; return route.fulfill({ json: { avatar_url: null } }); }
        uploads++;
        const image = route.request().postDataJSON().image;
        assert.match(image, /^data:image\/jpeg;base64,/);
        const dimensions = await page.evaluate(async source => { const image = new Image(); image.src = source; await image.decode(); return [image.naturalWidth, image.naturalHeight]; }, image);
        assert.deepEqual(dimensions, [512, 512]);
        return route.fulfill(fail ? { status: 503, json: { error: 'Storage unavailable.' } } : { json: { avatar_url: '/saved-photo.jpg' } });
      }
      if (url.pathname === '/saved-photo.jpg') return route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><rect width="512" height="512" fill="blue"/></svg>' });
      if (url.pathname === '/styles.css') return route.fulfill({ contentType: 'text/css', body: css });
      return route.fulfill({ contentType: 'text/html', body: `<meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css"><div id="root"></div><script>${bundle.outputFiles[0].text}</script>` });
    });
    await page.goto('http://account.test');
    const png = await page.evaluate(() => { const canvas = document.createElement('canvas'); canvas.width = 800; canvas.height = 400; const c = canvas.getContext('2d')!; c.fillStyle = 'red'; c.fillRect(0, 0, 400, 400); c.fillStyle = 'blue'; c.fillRect(400, 0, 400, 400); return canvas.toDataURL('image/png').split(',')[1]; });
    const choose = () => page.getByLabel('Choose profile picture').setInputFiles({ name: 'photo.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
    const editor = page.getByRole('dialog', { name: 'Crop profile picture' });
    await choose(); await editor.waitFor();
    await editor.getByRole('img', { name: 'Photo crop preview' }).evaluate((image: HTMLImageElement) => image.decode());
    await page.getByLabel('Zoom', { exact: true }).fill('2');
    await page.getByLabel('Horizontal position').fill('100');
    await editor.getByRole('button', { name: 'Cancel', exact: true }).click();
    assert.equal(uploads, 0, 'Cancel does not upload');
    await choose(); await editor.waitFor();
    await editor.getByRole('img').evaluate((image: HTMLImageElement) => image.decode());
    const crop = await editor.getByRole('img').locator('..').boundingBox();
    assert.equal(crop?.width, 256, 'Crop preview remains square at narrow widths');
    await editor.screenshot({ path: `test-results/profile-crop-${width}.png` });
    fail = true;
    const failedUpload = page.waitForResponse(response => response.url().endsWith('/api/auth/profile'));
    await editor.getByRole('button', { name: 'Save photo' }).click(); await failedUpload;
    await editor.getByRole('button', { name: 'Save photo', exact: true }).waitFor();
    assert.equal(await editor.isVisible(), true, 'Failed upload preserves the crop for retry');
    fail = false; await editor.getByRole('button', { name: 'Save photo' }).click(); await editor.waitFor({ state: 'hidden' });
    assert.equal(await page.getByRole('img', { name: /profile$/ }).count(), 2, 'Saved photo updates both profile and shared avatar');
    await page.screenshot({ path: `test-results/account-settings-${width}.png` });
    assert.equal(await page.getByRole('switch').count(), 0, 'Settings has no appearance toggle');
    await page.getByRole('button', { name: 'Remove photo' }).click();
    await page.getByRole('button', { name: 'Upload photo', exact: true }).waitFor(); assert.equal(deletes, 1);
    const trigger = page.getByRole('button', { name: 'EIR time (Malaysia)', exact: true });
    await trigger.click(); const picker = page.getByRole('dialog', { name: 'EIR time (Malaysia) picker' });
    const minute = picker.getByRole('listbox', { name: 'Minute', exact: true });
    await minute.hover(); await page.mouse.wheel(0, 72); await page.waitForTimeout(500);
    assert.equal(await picker.isVisible(), true, 'Internal wheel gestures keep the picker open');
    await page.evaluate(() => window.scrollBy(0, 150)); await picker.waitFor({ state: 'hidden' });
    const range = page.getByRole('button', { name: 'Minutes before', exact: true });
    await range.click(); const rangePicker = page.getByRole('dialog', { name: 'Minutes before picker' });
    await page.evaluate(() => window.scrollBy(0, 150)); await rangePicker.waitFor({ state: 'hidden' });
    assert.deepEqual(errors, []); await page.close();
  }
  console.log('Account photo crop, cancel, upload retry, shared avatar, removal and picker scroll dismissal passed at mobile and desktop widths.');
} finally { await browser.close(); }
