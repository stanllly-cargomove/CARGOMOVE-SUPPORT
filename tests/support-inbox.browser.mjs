// Optional browser verification against the production build and fixture APIs.
// No live Gmail or Supabase requests are permitted by the routing handler.
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE || 'playwright'
);
const root = path.resolve('dist');
const server = http.createServer(async (req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  const file = path.resolve(
    root,
    '.' + (pathname.startsWith('/assets/') ? pathname : '/index.html'),
  );
  if (!file.startsWith(root + path.sep)) {
    res.writeHead(403).end();
    return;
  }
  try {
    const bytes = await readFile(file);
    res.setHeader(
      'Content-Type',
      file.endsWith('.js')
        ? 'text/javascript'
        : file.endsWith('.css')
          ? 'text/css'
          : file.endsWith('.png')
            ? 'image/png'
            : 'text/html',
    );
    res.end(bytes);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({
  headless: true,
  args: ['--no-sandbox'],
});
let checks = 0;
try {
  let authenticated = true,
    connected = true,
    failCases = false,
    syncCalls = 0,
    analysisCalls = 0,
    savedAnalysis = null,
    failAnalysis = false;
  const id = '11111111-1111-4111-8111-111111111111';
  const record = {
    id,
    gmail_thread_id: 'thread1',
    customer_name: 'ABC Logistics',
    customer_email: 'customer@example.com',
    subject: 'Vehicle XYZ123 unavailable',
    status: 'NEW',
    category: 'VEHICLE',
    subcategory: null,
    port: 'WESTPORT',
    urgency: 'NORMAL',
    ai_confidence: null,
    assigned_to: null,
    created_at: '2026-09-16T08:00:00Z',
    updated_at: '2026-09-16T08:00:00Z',
    resolved_at: null,
    preview: 'Please help with our booking.',
    last_message_at: '2026-09-16T08:00:00Z',
  };
  const stats = {
    new_cases: 1,
    open_cases: 1,
    need_review: 0,
    ai_drafts: 0,
    resolved_today: 0,
    total_cases: 1,
    categories: [{ name: 'VEHICLE', count: 1 }],
    ports: [{ name: 'WESTPORT', count: 1 }],
  };
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1100 },
  });
  const queries = [];
  await context.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    let body = {};
    let status = 200;
    if (url.pathname === '/api/auth/session')
      body = {
        authenticated,
        user: authenticated
          ? { id: 'admin', type: 'ADMIN', email: 'support@example.com' }
          : null,
      };
    else if (url.pathname === '/api/snapshot')
      body = {
        ports: [],
        depots: [],
        companies: [],
        submissions: [],
        userRegistrations: [],
        guideline: null,
      };
    else if (url.pathname === '/api/external-user-access') body = { users: [] };
    else if (url.pathname === '/api/gmail/status')
      body = {
        connected,
        inboxPermissionGranted: connected,
        connection: connected
          ? { email: 'support@example.com', status: 'ACTIVE' }
          : null,
      };
    else if (url.pathname === '/api/gmail/sync') {
      syncCalls++;
      body = {
        mode: 'HISTORY',
        processed_threads: 1,
        inserted_messages: 1,
        has_more: syncCalls === 1,
        history_id: '100',
      };
    } else if (url.pathname === '/api/support/analysis') {
      body = { interaction: savedAnalysis, stale: false };
    } else if (url.pathname === '/api/support/analyze') {
      analysisCalls++;
      if (failAnalysis) {
        status = 503;
        body = {
          error:
            'AI is temporarily unavailable. Continue handling the case manually.',
        };
      } else {
        savedAnalysis = {
          id: 'analysis1',
          case_id: id,
          category: 'VEHICLE',
          subcategory: 'VEHICLE_NOT_FOUND',
          port: 'WESTPORT',
          language: 'MIXED_MS_EN',
          urgency: 'HIGH',
          confidence: 0.95,
          requires_human_review: true,
          short_explanation: 'Customer reports unavailable vehicle.',
          recommended_action: 'VERIFY_WITH_PORT',
          entities: { vehicle_number: 'XYZ123' },
        };
        body = { interaction: savedAnalysis, cached: false };
        record.status = 'NEEDS_REVIEW';
        record.ai_confidence = 0.95;
      }
    } else if (url.pathname === '/api/support/stats') body = stats;
    else if (url.pathname === '/api/support/cases') {
      queries.push(url.searchParams);
      if (failCases) {
        status = 503;
        body = { error: 'Support data is temporarily unavailable.' };
      } else {
        const visible = url.searchParams.get('q') !== 'nomatch';
        body = {
          cases: visible ? [record] : [],
          total: visible ? 1 : 0,
          assignees: [],
        };
      }
    } else if (url.pathname === '/api/support/case') {
      const older = url.searchParams.get('offset') === '50';
      body = {
        supportCase: record,
        message_total: 55,
        interactions: [],
        messages: [
          {
            id: older ? 'older' : 'latest',
            case_id: id,
            direction: 'INBOUND',
            sender_name: 'ABC Logistics',
            sender_email: 'customer@example.com',
            recipient_email: 'support@example.com',
            sent_at: '2026-09-16T08:00:00Z',
            body_text: older
              ? 'Older customer message'
              : 'Cannot book vehicle XYZ123. Please help.',
            body_html: '<img src=x onerror="window.incomingXss=true">',
          },
        ],
      };
    } else throw new Error(`Unexpected API request: ${url.pathname}`);
    await route.fulfill({
      status,
      contentType: 'application/json',
      body: JSON.stringify(body),
    });
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(origin + '/admin/support');
  await page.getByRole('heading', { name: 'Recent cases' }).waitFor();
  checks++;
  await page.getByRole('button', { name: 'Open support inbox' }).click();
  await page.getByRole('heading', { name: 'AI Email Assistant' }).waitFor();
  assert.equal(new URL(page.url()).pathname, '/admin/support/inbox');
  checks++;
  await page.getByRole('button', { name: /ABC Logistics/ }).click();
  await page
    .getByText('Cannot book vehicle XYZ123. Please help.', { exact: true })
    .waitFor();
  assert.equal(new URL(page.url()).pathname, `/admin/support/case/${id}`);
  assert.equal(await page.locator('img[src="x"]').count(), 0);
  assert.equal(await page.evaluate(() => window.incomingXss), undefined);
  checks += 3;
  await page.getByText('No AI analysis has been run for this case.').waitFor();
  assert.equal(analysisCalls, 0);
  checks++;
  await page.getByRole('button', { name: 'Analyze case', exact: true }).click();
  await page.getByText('95% confidence', { exact: true }).waitFor();
  await page.getByText('Human review required', { exact: true }).waitFor();
  assert.equal(analysisCalls, 1);
  checks += 2;
  failAnalysis = true;
  await page.getByRole('button', { name: 'Analyze case', exact: true }).click();
  await page
    .getByText(
      'AI is temporarily unavailable. Continue handling the case manually.',
    )
    .waitFor();
  assert.ok(
    await page
      .getByText('Cannot book vehicle XYZ123. Please help.', { exact: true })
      .isVisible(),
  );
  checks++;
  failAnalysis = false;
  await page.screenshot({
    path: '/tmp/cargomove-support-desktop.png',
    fullPage: true,
  });
  await page
    .getByRole('button', { name: 'Older messages', exact: true })
    .click();
  await page.getByText('Older customer message', { exact: true }).waitFor();
  checks++;
  await page.goBack();
  await page.getByRole('heading', { name: 'Select a conversation' }).waitFor();
  checks++;
  await page
    .getByPlaceholder('Search customer, message, or reference…')
    .fill('nomatch');
  await page.getByText('No support cases match your search.').waitFor();
  checks++;
  await page.getByRole('button', { name: 'Clear filters' }).click();
  await page.getByRole('button', { name: /ABC Logistics/ }).waitFor();
  await page
    .getByRole('combobox', { name: 'Status', exact: true })
    .selectOption('NEW');
  await page.waitForTimeout(450);
  assert.ok(queries.some((q) => q.get('status') === 'NEW'));
  checks++;
  assert.equal(syncCalls, 0);
  checks++;
  await page.getByRole('button', { name: 'Sync Gmail', exact: true }).click();
  await page
    .getByRole('button', { name: 'Continue sync', exact: true })
    .waitFor();
  await page
    .getByRole('button', { name: 'Continue sync', exact: true })
    .click();
  await page.getByText(/Inbox is up to date/).waitFor();
  assert.equal(syncCalls, 2);
  checks++;
  failCases = true;
  await page
    .getByRole('button', { name: 'Refresh cases', exact: true })
    .click();
  await page.getByText('Support data is temporarily unavailable.').waitFor();
  checks++;
  failCases = false;
  connected = false;
  await page
    .getByRole('button', { name: 'Refresh cases', exact: true })
    .click();
  await page.getByText('Gmail is not connected.').waitFor();
  await page.getByRole('button', { name: /ABC Logistics/ }).waitFor();
  checks++;
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(250);
  await page.screenshot({
    path: '/tmp/cargomove-support-mobile.png',
    fullPage: true,
  });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
    true,
  );
  checks++;
  await page
    .getByRole('button', { name: 'Operations Dashboard', exact: true })
    .click();
  assert.equal(new URL(page.url()).pathname, '/');
  checks++;
  await page.goto(origin + `/admin/support/case/${id}`);
  await page
    .getByText('Cannot book vehicle XYZ123. Please help.', { exact: true })
    .waitFor();
  checks++;
  authenticated = false;
  await page.goto(origin + '/admin/support/inbox');
  await page.getByRole('button', { name: /Sign In|Log In|Login/i }).waitFor();
  assert.equal(
    await page.getByRole('heading', { name: 'AI Email Assistant' }).count(),
    0,
  );
  checks++;
  assert.deepEqual(errors, []);
  checks++;
  await context.close();
  console.log(
    `${checks} desktop/mobile navigation, privacy, sync and error checks passed.`,
  );
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
