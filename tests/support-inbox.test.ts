import assert from 'node:assert/strict';
import test from 'node:test';
import type { Request, Response } from 'express';
import {
  supportFilters,
  SupportQueryError,
} from '../server-handlers/support/queries.js';
import cases from '../server-handlers/support/cases.js';
import caseDetail from '../server-handlers/support/case.js';
import stats from '../server-handlers/support/stats.js';
import { supportTab, supportCaseId } from '../src/utils/support/routes.js';
test('strictly validates filters, UUID assignment, UTC date ranges and bounded offsets', () => {
  const filters = supportFilters({
    q: '  booking  ',
    status: 'NEW',
    port: 'WESTPORT',
    from: '2026-09-15',
    to: '2026-09-16',
    assigned_to: 'UNASSIGNED',
    offset: '20',
  });
  assert.equal(filters.q, 'booking');
  assert.equal(filters.to, '2026-09-17T00:00:00.000Z');
  assert.equal(filters.offset, 20);
  for (const query of [
    { status: 'INVALID' },
    { port: 'ALL' },
    { confidence: '100' },
    { assigned_to: 'not-staff' },
    { offset: '-1' },
    { offset: '100001' },
    { q: ['a', 'b'] },
    { from: '2026-02-30' },
    { from: '2026-09-16', to: '2026-09-15' },
  ])
    assert.throws(
      () => supportFilters(query as Request['query']),
      SupportQueryError,
    );
});
test('recognizes support links and rejects unrelated path prefixes', () => {
  assert.equal(supportTab('/admin/support'), 'support-dashboard');
  assert.equal(supportTab('/admin/support/inbox'), 'support-inbox');
  assert.equal(supportCaseId('/admin/support/case/test'), 'test');
  assert.equal(supportTab('/admin/support/inbox/extra'), null);
  assert.equal(supportTab('/admin/support/knowledge'), 'support-knowledge');
});
test('every support API requires ADMIN before database access and rejects write methods', async () => {
  for (const handler of [cases, caseDetail, stats]) {
    let code = 0;
    const response = {
      setHeader() {},
      status(n: number) {
        code = n;
        return this;
      },
      json() {
        return this;
      },
    };
    await handler(
      { method: 'GET', headers: {}, query: {} } as Request,
      response as unknown as Response,
    );
    assert.equal(code, 401);
    await handler(
      { method: 'POST', headers: {}, query: {} } as Request,
      response as unknown as Response,
    );
    assert.equal(code, 405);
  }
});
