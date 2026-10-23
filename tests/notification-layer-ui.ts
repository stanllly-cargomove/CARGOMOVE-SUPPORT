// Offline browser regression for document and native-dialog notification layers.
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

const bundle = await build({ stdin: { contents: `
  import React, {useRef} from 'react';
  import {createRoot} from 'react-dom/client';
  import {NotificationToaster} from './src/components/common/NotificationToaster';
  import {notifySuccess} from './src/components/common/notifications';
  function App() {
    const first=useRef(null),second=useRef(null);
    return <><aside className="fixed inset-y-0 left-0 z-50 w-48 bg-blue-950"/>
      <main style={{marginLeft:192}}><button onClick={()=>notifySuccess('Visible notification',{toasterId:'northport',duration:60000})}>Notify</button>
      <button onClick={()=>first.current.showModal()}>Open first</button>
      <dialog ref={first} aria-label="First" style={{height:384}} className="m-auto w-80 overflow-hidden bg-white">
        <button onClick={()=>second.current.showModal()}>Open second</button>
        <button onClick={()=>first.current.close()}>Close first</button>
      </dialog>
      <dialog ref={second} aria-label="Second" style={{height:320}} className="m-auto w-72 overflow-hidden bg-white">
        <button onClick={()=>second.current.close()}>Close second</button>
      </dialog></main>
      <NotificationToaster toasterId="northport" position="top-center"/>
    </>;
  }
  createRoot(document.getElementById('root')).render(<App/>);
`, resolveDir: process.cwd(), loader: 'tsx' }, bundle: true, write: false, format: 'iife', platform: 'browser', define: { 'process.env.NODE_ENV': '"test"' } });
const css = (await Promise.all((await readdir('dist/assets')).filter(file => file.endsWith('.css')).map(file => readFile('dist/assets/' + file, 'utf8')))).join('\n');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  for (const width of [390, 1100]) {
    const page = await browser.newPage({ viewport: { width, height: 800 } });
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => route.fulfill({ contentType: 'text/html', body: `<style>${css}</style><div id="root"></div><script>${bundle.outputFiles[0].text}</script>` }));
    await page.goto('http://notifications.test');
    await page.getByRole('button', { name: 'Notify', exact: true }).click();
    const notice = page.getByRole('status').filter({ hasText: 'Visible notification' });
    const check = async (dialog: string | null) => {
      await page.waitForFunction(expected => {
        const nodes = [...document.querySelectorAll('[role="status"]')].filter(node => node.textContent?.includes('Visible notification'));
        return nodes.length === 1 && (nodes[0].closest('dialog')?.getAttribute('aria-label') || null) === expected;
      }, dialog);
      assert.equal(await notice.count(), 1);
      await page.waitForFunction(() => {
        const element = [...document.querySelectorAll('[role="status"]')].find(node => node.textContent?.includes('Visible notification'))!;
        const box = element.getBoundingClientRect();
        return element.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2));
      });
      const visibility = await notice.evaluate(element => {
        const box = element.getBoundingClientRect();
        const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
        return {visible:element.contains(hit),box:box.toJSON(),hit:hit?.outerHTML.slice(0,200),dialog:element.closest('dialog')?.getBoundingClientRect().toJSON()};
      });
      assert.equal(visibility.visible, true, JSON.stringify(visibility));
    };
    await check(null);
    await page.getByRole('button', { name: 'Open first', exact: true }).click(); await check('First');
    await page.getByRole('button', { name: 'Open second', exact: true }).click(); await check('Second');
    await page.getByRole('button', { name: 'Close second', exact: true }).click(); await check('First');
    await page.getByRole('button', { name: 'Close first', exact: true }).click(); await check(null);
    assert.deepEqual(errors, []);
    await page.close();
  }
  console.log('Notifications remain single and visible across document, modal and nested modal layers at mobile/desktop widths.');
} finally { await browser.close(); }
