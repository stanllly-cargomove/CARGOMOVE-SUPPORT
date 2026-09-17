import test from 'node:test';
import assert from 'node:assert/strict';
import type { Request, Response } from 'express';
import {
  validateReply,
  editedReply,
  replyTemplate,
} from '../server-handlers/ai/reply-validation.js';
import { AnalysisError } from '../server-handlers/ai/validation.js';
import { SupportQueryError } from '../server-handlers/support/queries.js';
import {
  replyGenerate,
  replyRead,
  replyEdit,
} from '../server-handlers/ai/reply-handlers.js';
import type { SupportKnowledge } from '../src/types/knowledge.js';
const article = {
  id: '11111111-1111-4111-8111-111111111111',
  active: true,
  ai_reply_allowed: true,
} as SupportKnowledge;
test('accepts concise grounded Malay reply with only allowed sources', () => {
  const result = validateReply(
    {
      reply_text:
        'Sila semak panduan pendaftaran kenderaan. Pengesahan pelabuhan memerlukan semakan manusia.',
      knowledge_ids: [article.id],
    },
    'KNOWLEDGE',
    [article],
  );
  assert.equal(result.knowledge_ids[0], article.id);
});
test('rejects invented, duplicate, disabled, missing and inappropriate knowledge references', () => {
  for (const ids of [[], ['invented'], [article.id, article.id], [null]])
    assert.throws(
      () =>
        validateReply(
          { reply_text: 'Guidance for staff review.', knowledge_ids: ids },
          'KNOWLEDGE',
          [article],
        ),
      AnalysisError,
    );
  for (const flags of [{ active: false }, { ai_reply_allowed: false }])
    assert.throws(
      () =>
        validateReply(
          { reply_text: 'Guidance.', knowledge_ids: [article.id] },
          'KNOWLEDGE',
          [{ ...article, ...flags }],
        ),
      AnalysisError,
    );
  assert.throws(
    () =>
      validateReply(
        { reply_text: 'Thanks.', knowledge_ids: [article.id] },
        'ACKNOWLEDGE',
        [article],
      ),
    AnalysisError,
  );
});
test('rejects extra reasoning fields, HTML, redaction placeholders and common invented status claims', () => {
  for (const text of [
    'We have approved your booking.',
    'Kami telah mengesahkan tempahan anda.',
    'Early Entry has been approved.',
    'Your vehicle is registered.',
    '<script>alert(1)</script>',
    'Dear [email omitted]',
    'x'.repeat(6001),
    '',
  ])
    assert.throws(
      () =>
        validateReply(
          { reply_text: text, knowledge_ids: [] },
          'ACKNOWLEDGE',
          [],
        ),
      AnalysisError,
    );
  assert.throws(
    () =>
      validateReply(
        {
          reply_text: 'Thank you.',
          knowledge_ids: [],
          hidden_reasoning: 'private',
        },
        'ACKNOWLEDGE',
        [],
      ),
    AnalysisError,
  );
});
test('editor accepts plain text but bounds it; templates are an enum', () => {
  assert.equal(editedReply('  Staff edited reply.  '), 'Staff edited reply.');
  assert.throws(() => editedReply(''), SupportQueryError);
  assert.throws(() => replyTemplate('SEND'), SupportQueryError);
  assert.equal(replyTemplate('REQUEST_DETAILS'), 'REQUEST_DETAILS');
});
test('all reply APIs guard admin sessions and do not expose sending methods', async () => {
  for (const [handler, method] of [
    [replyRead, 'GET'],
    [replyGenerate, 'POST'],
    [replyEdit, 'PUT'],
  ] as const) {
    let status = 0;
    const response = {
      setHeader() {},
      status(n: number) {
        status = n;
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
    assert.equal(status, 401);
    await handler(
      { method: 'DELETE', headers: {}, query: {} } as Request,
      response as unknown as Response,
    );
    assert.equal(status, 405);
  }
});
