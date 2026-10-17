// Build first with npm run build. All browser requests are intercepted locally.
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

const bundle = await build({ stdin: { contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {NorthportRecovery} from './src/components/admin/NorthportRecovery';createRoot(document.getElementById('root')).render(<NorthportRecovery onBack={()=>{}}/>);`, resolveDir: process.cwd(), loader: 'tsx' }, bundle: true, write: false, format: 'iife', platform: 'browser', define: { 'process.env.NODE_ENV': '"test"' } });
const cssFiles = (await readdir('dist/assets')).filter(file => file.endsWith('.css'));
const css = (await Promise.all(cssFiles.map(file => readFile(join('dist/assets', file), 'utf8')))).join('\n');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage();
  page.setDefaultTimeout(10000);
  const pageErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  const values = Array(20).fill(''); values[0] = 'FTAU1735746'; values[3] = 'SNKU010210006677'; values[16] = '2026-10-17 19:54';
  let finishSearch: (() => void) | undefined;
  const history = [{ id: 'recovery-1', container: values[0], container_type: 'GP', source_filename: 'CM_CONTAINER_20261017162920_GP.csv', recovery_filename: 'CM_CONTAINER_20261017163934_GP.csv', submitted_by: 'support@example.test', created_at: '2026-10-17T08:39:11Z', changed_fields: [], status: 'Scheduler Triggered', scheduler_status: 'trigger_requested' }];
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    assert.equal(url.origin, 'http://northport.test');
    if (url.pathname === '/api/dev-tools/northport-recovery') {
      if (route.request().method() === 'GET') return route.fulfill({ json: { history, uploadsEnabled: false, missingGates: [] } });
      await new Promise<void>(resolve => { finishSearch = resolve; });
      return route.fulfill({ json: { matches: [{ filename: history[0].source_filename, type: 'GP', timestamp: '2026-10-17T16:29:20', record: 1, values, token: 'test-token' }], errors: [], complete: true, candidates: 1, listed: 1, progress: { checked: 2101, total: 2101, files: 1, records: 1 } } });
    }
    if (url.pathname === '/styles.css') return route.fulfill({ contentType: 'text/css', body: css });
    return route.fulfill({ contentType: 'text/html', body: `<meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css"><main style="padding:16px"><div id="root"></div></main><script>${bundle.outputFiles[0].text}</script>` });
  });
  const checkOverflow = async () => assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'Page must fit viewport');
  for (const width of [320, 390, 640, 768, 1024, 1440]) {
    console.log(`Checking ${width}px`);
    await page.setViewportSize({ width, height: 900 });
    await page.goto('http://northport.test');
    await page.getByRole('heading', { name: 'Recovery History', exact: true }).waitFor();
    const historyHeading = await page.getByRole('heading', { name: 'Recovery History', exact: true }).locator('..').boundingBox();
    const refreshHistory = await page.getByRole('button', { name: 'Refresh History', exact: true }).boundingBox();
    assert.ok(historyHeading && refreshHistory && Math.abs((historyHeading.y+historyHeading.height/2)-(refreshHistory.y+refreshHistory.height/2))<2, 'Refresh must be vertically centered beside the history heading and description');
    const searchCard = await page.locator('.northport-search-card').boundingBox();
    assert.equal(await page.getByRole('spinbutton', { name: 'Minutes before' }).isVisible(), !!searchCard && searchCard.width>934, 'Time range visibility must follow the available card width');
    await checkOverflow();
    const checkHistoryFit = async () => {
      assert.equal(await page.locator('.northport-history-container').evaluate(card => card.scrollWidth<=card.clientWidth), true, 'History must fit its card without horizontal scrolling');
      if (await page.locator('.northport-history-table').isVisible()) {
        assert.equal(await page.locator('.northport-history-table td').evaluateAll(cells => cells.every(cell=>cell.scrollWidth<=cell.clientWidth)), true, 'History cells must show their full values without clipping');
      }
    };
    await checkHistoryFit();
    if (width>=768) {
      await page.locator('main').evaluate(main => { main.style.paddingLeft='240px'; });
      await checkHistoryFit();
      await page.locator('main').evaluate(main => { main.style.paddingLeft='16px'; });
    }
    if (width < 640) {
      const eir = await page.getByLabel('EIR time (Malaysia)', { exact: true }).boundingBox();
      const type = await page.getByRole('combobox').boundingBox();
      const card = await page.getByRole('heading', { name: 'Search Container', exact: true }).locator('xpath=ancestor::section').boundingBox();
      assert.ok(eir && type && card && Math.abs(eir.y-type.y)<2, 'EIR time and type must share a row');
      assert.ok(eir && type && eir.x+eir.width<type.x, 'EIR time must not overlap container type');
      assert.ok(eir && type && Math.abs(eir.height-type.height)<2, 'Both controls must have the same height');
      assert.ok(eir.x>=card.x && type.x+type.width<=card.x+card.width, 'Both fields must fit inside the card');
      assert.equal(await page.getByRole('spinbutton', { name: 'Minutes before' }).isVisible(), false, 'Time range must be hidden on phones');
      await page.getByRole('button', { name: 'How it works', exact: true }).click();
      await checkOverflow();
      await page.keyboard.press('Escape');
      await page.getByRole('button', { name: 'Northport FTP connection options', exact: true }).click();
      await checkOverflow();
      await page.keyboard.press('Escape');
    }
    if (width < 768) {
      assert.equal(await page.locator('table:visible').count(), 0);
      await page.getByRole('button', { name: `View recovery details for ${values[0]}` }).click();
      const detailsDialog = page.getByRole('dialog', { name: 'Recovery details', exact: true });
      await detailsDialog.waitFor();
      assert.equal(await detailsDialog.getByRole('button').count(), 1, 'Recovery details must have a single close button');
      assert.ok((await detailsDialog.locator('dd').allTextContents()).every(text => text.trim()), 'Recovery details must not show empty fields');
      const detailsHeading = await detailsDialog.getByRole('heading').boundingBox();
      const detailsClose = await detailsDialog.getByRole('button').boundingBox();
      assert.ok(detailsHeading && detailsClose && Math.abs(detailsHeading.y-detailsClose.y)<10, 'Recovery details header and close button must align');
      await checkOverflow();
      await page.getByRole('button', { name: 'Close recovery details', exact: true }).click();
    }
    await page.getByLabel('Container No.', { exact: true }).fill(values[0]);
    await page.getByLabel('EIR time (Malaysia)', { exact: true }).fill('2026-10-17T16:30');
    await page.getByRole('button', { name: 'Search FTP', exact: true }).click();
    while (!finishSearch) await new Promise(resolve => setTimeout(resolve, 5));
    const rangeBefore = await page.locator('.northport-search-details').evaluate(element=>Array.from(element.closest('section')!.children).indexOf(element.parentElement!));
    assert.equal(await page.locator('.border-dashed .northport-search-details').count(), 0, 'Range and progress must sit outside the empty-state panel');
    if (width < 640) {
      await page.getByText('Connecting to FTP', { exact: true }).waitFor();
      assert.equal(await page.getByText('The search is still running.', { exact: false }).isVisible(), false, 'Verbose scanning explanation must be hidden on mobile');
      const details = page.locator('[aria-live="polite"]').filter({ hasText: 'Search range:' });
      assert.ok(!(await details.innerText()).includes('MYT'), 'Mobile search range must omit timezone labels');
      assert.ok(!(await details.innerText()).includes('Search range:'), 'Mobile search range must omit its label');
    }
    finishSearch(); finishSearch = undefined;
    if (width < 768) {
      await page.getByRole('button', { name: 'View / Edit', exact: true }).waitFor();
      await page.getByRole('button', { name: 'View / Edit', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'Container file editor', exact: true });
      await dialog.waitFor();
      const editorBounds = await dialog.boundingBox();
      assert.equal(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth), true, 'Editor must not scroll horizontally');
      const unit = await dialog.getByLabel('UNIT', { exact: true }).boundingBox();
      const gpno = await dialog.getByLabel('GPNO', { exact: true }).boundingBox();
      assert.ok(unit && gpno && Math.abs(unit.y-gpno.y)<2 && unit.x+unit.width<gpno.x, 'Data fields must use two columns on mobile');
      assert.ok(unit && unit.height<=36, 'Parameter inputs must use a compact height');
      assert.equal(await dialog.getByRole('button', { name: 'Close file editor', exact: true }).count(), 0, 'Editor must use the footer Cancel instead of an X');
      const headerText = await dialog.locator('p').first().innerText();
      assert.equal(headerText.includes('MYT'), false, 'Header must omit the timestamp');
      assert.equal(headerText.includes('Record'), false, 'Header must omit the record number');
      const actions = await dialog.locator('.northport-dialog-actions > button').all();
      const positions = await Promise.all(actions.map(action => action.boundingBox()));
      assert.ok(positions.every(position => position && Math.abs(position.y-positions[0]!.y)<2), 'Editor actions must stay on one row');
      assert.equal(await dialog.getByRole('button', { name: 'Reset Changes', exact: true }).isDisabled(), true);
      await dialog.getByLabel('SRV', { exact: true }).fill('I');
      assert.equal(await dialog.getByRole('button', { name: 'Reset Changes', exact: true }).isEnabled(), true);
      await dialog.getByRole('button', { name: width<640?'Review':'Review Record', exact: true }).click();
      await dialog.getByRole('button', { name: 'Reset Changes', exact: true }).click();
      assert.equal(await dialog.getByRole('button', { name: 'Reset Changes', exact: true }).isDisabled(), true);
      await dialog.getByRole('heading', { name: `Review & Approval — ${values[0]}`, exact: true }).waitFor();
      const reviewBounds = await dialog.boundingBox();
      assert.ok(editorBounds && reviewBounds && Math.abs(editorBounds.width-reviewBounds.width)<1 && Math.abs(editorBounds.height-reviewBounds.height)<1 && Math.abs(editorBounds.y-reviewBounds.y)<1 && editorBounds.height<=830, 'Editor and review must keep the same compact size and position');
      const reviewActions = await dialog.locator('.northport-dialog-actions > button').all();
      const reviewPositions = await Promise.all(reviewActions.map(action => action.boundingBox()));
      assert.ok(reviewPositions.length===3 && reviewPositions.every(position => position && Math.abs(position.y-reviewPositions[0]!.y)<2), 'Review actions must stay on one row');
      assert.equal(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth), true, 'Review must not scroll horizontally');
      await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    } else {
      await page.getByRole('button', { name: 'Record actions', exact: true }).waitFor();
      const checkResultsFit = async () => {
        assert.equal(await page.locator('.northport-results-container').evaluate(card => card.scrollWidth<=card.clientWidth), true, 'Results must fit without horizontal scrolling');
        if (await page.locator('.northport-results-table').isVisible()) {
          assert.equal(await page.locator('.northport-results-table td').evaluateAll(cells => cells.every(cell=>cell.scrollWidth<=cell.clientWidth)), true, 'Result cells and Actions must not be clipped');
          assert.equal(await page.locator('.northport-results-table th').evaluateAll(headers => headers.every(header=>{
            const style=getComputedStyle(header);
            const contentHeight=header.getBoundingClientRect().height-parseFloat(style.paddingTop)-parseFloat(style.paddingBottom);
            const maxLines=header.closest('table')!.clientWidth>900?1:2;
            return contentHeight<=parseFloat(style.lineHeight)*maxLines+2 && style.verticalAlign==='middle' && header.scrollWidth<=header.clientWidth;
          })), true, 'Result headers must fit within two lines without splitting words or clipping');
        }
      };
      await checkResultsFit();
      await page.locator('main').evaluate(main => { main.style.paddingLeft='240px'; });
      await checkResultsFit();
      await page.locator('main').evaluate(main => { main.style.paddingLeft='16px'; });
      await page.getByRole('button', { name: 'Record actions', exact: true }).click();
      await page.getByRole('button', { name: 'View/Edit File', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'Container file editor', exact: true });
      const editorBox = await dialog.boundingBox();
      const editorFooter = await dialog.locator('.northport-dialog-footer').boundingBox();
      assert.ok(editorBox && editorFooter && editorBox.y+editorBox.height-(editorFooter.y+editorFooter.height)<=24, 'Desktop editor must end directly below its footer');
      await dialog.getByRole('button', { name: 'Review Record', exact: true }).click();
      const fields = dialog.locator('.northport-parameter-grid > div');
      const columnCount = width>=1280?10:width>=768?5:2;
      const top = await fields.nth(0).boundingBox();
      const bottom = await fields.nth(columnCount).boundingBox();
      assert.ok(top && bottom && Math.abs(top.width-bottom.width)<1 && Math.abs(top.x-bottom.x)<1, 'Field columns must align between rows');
      const valueBoxes = await fields.locator('p:nth-child(2)').all();
      for (const value of valueBoxes) assert.ok((await value.boundingBox())!.height<=36, 'Review values must stay on a single row');
      const gridBounds = await dialog.locator('.northport-parameter-grid').boundingBox();
      const footerBounds = await dialog.locator('.northport-dialog-footer').boundingBox();
      assert.ok(gridBounds && footerBounds && footerBounds.y-(gridBounds.y+gridBounds.height)<=84, 'Review footer must follow the shared message slot without a large empty area');
      const reviewBox = await dialog.boundingBox();
      assert.ok(editorBox && reviewBox && Math.abs(editorBox.height-reviewBox.height)<1 && Math.abs(editorBox.y-reviewBox.y)<1, 'Desktop editor and review must keep identical size and position');
      assert.ok(reviewBox && footerBounds && reviewBox.y+reviewBox.height-(footerBounds.y+footerBounds.height)<=24, 'Desktop review must end directly below its footer');
      await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    }
    await checkOverflow();
    const rangeAfter = await page.locator('.northport-search-details').evaluate(element=>Array.from(element.closest('section')!.children).indexOf(element.parentElement!));
    assert.equal(rangeBefore, 2, 'Search range must follow the progress bar');
    assert.equal(rangeAfter, rangeBefore, 'Search range must stay in the same location before and after matches arrive');
    if (width === 390) await page.screenshot({ path: join(tmpdir(), 'northport-mobile.png'), fullPage: true });
  }
  assert.deepEqual(pageErrors, []);
  console.log('Northport responsive layouts passed at 320, 390, 640, 768, 1024 and 1440px, including history beside an expanded sidebar.');
} finally { await browser.close(); }
