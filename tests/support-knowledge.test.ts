import test from 'node:test';
import assert from 'node:assert/strict';
import type { Request, Response } from 'express';
import {
  knowledgeArticle,
  knowledgeFilters,
  expectedVersion,
} from '../server-handlers/knowledge/validation.js';
import articles from '../server-handlers/knowledge/articles.js';
import matches from '../server-handlers/knowledge/matches.js';
import { SupportQueryError } from '../server-handlers/support/queries.js';
const valid = () => ({
  knowledge_code: 'KB-VEHICLE-001',
  title: 'Vehicle registration guidance',
  category: 'VEHICLE',
  subcategory: 'VEHICLE_NOT_FOUND',
  port: 'ALL',
  problem: 'Vehicle missing during booking.',
  possible_cause: null,
  resolution: 'Staff should check registration guidance.',
  suggested_action: null,
  keywords: ['vehicle', 'lorry'],
  requires_port_verification: false,
  human_review_required: true,
  ai_reply_allowed: false,
  active: false,
});
test('curates writable fields and normalizes required text and keywords', () => {
  const article = knowledgeArticle({
    ...valid(),
    title: '  Guidance  ',
    keywords: ['vehicle', 'vehicle'],
    created_by: 'forged',
    updated_by: 'forged',
  });
  assert.equal(article.title, 'Guidance');
  assert.deepEqual(article.keywords, ['vehicle']);
  assert.ok(!Object.hasOwn(article, 'created_by'));
  assert.ok(!Object.hasOwn(article, 'updated_by'));
});
test('rejects unknown enums, conflicting subcategories, unsafe flags and oversized content', () => {
  for (const patch of [
    { category: 'BOGUS' },
    { subcategory: 'LOGIN' },
    { port: 'PORT_A' },
    { knowledge_code: 'bad code' },
    { resolution: '' },
    { title: 'x'.repeat(201) },
    { active: 'true' },
    { keywords: [''] },
    { keywords: Array(31).fill('word') },
    { keywords: ['x'.repeat(81)] },
    { requires_port_verification: true, human_review_required: false },
  ])
    assert.throws(
      () => knowledgeArticle({ ...valid(), ...patch }),
      SupportQueryError,
    );
  assert.throws(
    () =>
      knowledgeArticle({
        ...valid(),
        category: 'BOOKING',
        subcategory: 'EARLY_ENTRY',
        human_review_required: false,
      }),
    SupportQueryError,
  );
});
test('validates exact filter values, search size, offset and optimistic timestamp', () => {
  assert.deepEqual(
    knowledgeFilters({ active: 'true', q: ' vehicle ', offset: '20' }),
    { active: 'true', q: 'vehicle', offset: 20 },
  );
  for (const query of [
    { active: 'yes' },
    { ai_reply_allowed: '1' },
    { port: 'INVALID' },
    { subcategory: 'BOGUS' },
    { offset: '-1' },
    { q: 'x'.repeat(201) },
  ])
    assert.throws(() => knowledgeFilters(query), SupportQueryError);
  assert.equal(
    expectedVersion('2026-09-16T12:00:00.123456+00:00'),
    '2026-09-16T12:00:00.123456+00:00',
  );
  assert.throws(() => expectedVersion(undefined), SupportQueryError);
});
test('knowledge APIs require admin authentication before reads/writes and expose no delete', async () => {
  for (const [handler, methods] of [
    [articles, ['GET', 'POST', 'PUT']],
    [matches, ['GET']],
  ] as const) {
    for (const method of [...methods, 'DELETE']) {
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
        { method, headers: {}, query: {} } as Request,
        response as unknown as Response,
      );
      assert.equal(code, method === 'DELETE' ? 405 : 401);
    }
  }
});
