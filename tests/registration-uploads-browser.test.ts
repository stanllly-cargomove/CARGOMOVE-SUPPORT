// Real browser interactions against local intercepted fixtures. No external requests.
import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import * as XLSX from 'xlsx';
import { uploadWorkbook } from '../server-handlers/registration-uploads/automation.js';

test('Playwright selects each pane, attaches the workbook, reads a locked picker, and sends a single upload after its durable marker', async () => {
  for (const entity of ['vehicle', 'trailer', 'driver']) {
    const workbook = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['REGISTRATION'], ['T/123']]), 'Sheet1');
    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
    let marker = 0, uploads = 0, aborted = 0;
    const filename = `CMREG400001_${entity.toUpperCase()}_fixture.xlsx`;
    const launch = async () => {
      const browser = await chromium.launch({ channel: 'chrome', headless: true });
      const originalNewContext = browser.newContext.bind(browser);
      browser.newContext = async options => {
        const context = await originalNewContext(options);
        const originalRoute = context.route.bind(context);
        context.route = async (pattern, handler: any) => originalRoute(pattern, route => handler({
          request: () => route.request(), abort: () => { aborted++; return route.abort(); },
          continue: async () => {
            const request = route.request(), url = new URL(request.url());
            assert.equal(url.origin, 'https://www.cargomove.my');
            // Avoid redirects: browser redirect requests can bypass route interception.
            if (url.pathname === '/user/login') return route.fulfill({ contentType: 'text/html', body: 'Authenticated fixture' });
            if (url.pathname === '/administration/data_entry_uploads_list_ajax') return route.fulfill({ json: { state: true, results: [] } });
            if (url.pathname === '/administration/data_entry_upload_ajax') {
              assert.equal(marker, 1, 'Persist dispatch intent before the browser can submit');
              uploads++;
              const payload = request.postDataJSON();
              assert.equal(payload.entity, entity); assert.equal(payload.filename, filename); assert.equal(payload.country, 'MY');
              assert.deepEqual(Buffer.from(payload.base64, 'base64'), buffer);
              return route.fulfill({ json: { state: true } });
            }
            if (url.pathname === '/administration/data_entry') return route.fulfill({ contentType: 'text/html', body: `
              <select id="jmd-country"><option value="MY">Malaysia</option></select>
              ${['vehicle', 'trailer', 'driver'].map(name => `<a href="#pane-${name}" onclick="event.preventDefault();document.querySelectorAll('section').forEach(p=>p.style.display='none');document.getElementById('pane-${name}').style.display='block'">${name}</a>
              <section id="pane-${name}" style="display:none"><input type="file" id="file-${name}" onchange="this.disabled=true"/>
              <button class="btn-upload" data-entity="${name}" onclick="send('${name}')">Upload</button></section>`).join('')}
              <script>function send(entity){const f=document.getElementById('file-'+entity).files[0],r=new FileReader();r.onload=()=>{
                const payload={entity,country:'MY',filename:f.name,base64:r.result.split('base64,')[1]};
                fetch('/administration/data_entry_upload_ajax',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
              };r.readAsDataURL(f);}
              fetch('/administration/run_scheduled_task?id=forbidden').catch(()=>{});
              fetch('https://foreign.example.test/collect').catch(()=>{});</script>` });
            if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: `<form action="https://www.cargomove.my/user/login" method="POST"><input id="materialFormUsername"/><input id="materialFormLoginPasswordEx" type="password"/><button type="submit">Login</button></form>` });
            if (url.pathname === '/bookings') return route.fulfill({ contentType: 'text/html', body: 'Bookings fixture' });
            assert.fail(`Unexpected request ${request.method()} ${url.pathname}`);
          },
        }));
        return context;
      };
      return browser;
    };
    const result = await uploadWorkbook({ username: 'fixture', password: 'fixture' }, { entity, filename, expected_rows: 1 }, buffer, async () => { marker++; }, launch);
    assert.equal(result.state, 'UPLOADED'); assert.equal(uploads, 1); assert.ok(aborted >= 2);
  }
});
