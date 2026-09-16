import test from 'node:test';
import assert from 'node:assert/strict';
import type { Request, Response } from 'express';
import {
  validateClassification,
  ENTITY_KEYS,
  AnalysisError,
} from '../server-handlers/ai/validation.js';
import { analysisContext, redactText } from '../server-handlers/ai/context.js';
import { classificationConfig } from '../server-handlers/ai/provider.js';
import analyze from '../server-handlers/ai/analyze.js';
import analysis from '../server-handlers/ai/analysis.js';
import type { SupportMessage } from '../src/types/support.js';
const valid = () => ({
  category: 'VEHICLE',
  subcategory: 'VEHICLE_NOT_FOUND',
  port: 'WESTPORT',
  language: 'MIXED_MS_EN',
  urgency: 'HIGH',
  confidence: 0.99,
  entities: Object.fromEntries(
    ENTITY_KEYS.map((k) => [k, k === 'vehicle_number' ? 'XYZ123' : null]),
  ),
  recommended_action: 'VERIFY_WITH_PORT',
  requires_human_review: false,
  short_explanation: 'Customer reports vehicle XYZ123 is unavailable.',
});
const evidence = 'Syarikat ABC: vehicle XYZ123 cannot book at Westport.';
test('validates bilingual classification and enforces human review even at 99% confidence', () => {
  const result = validateClassification(valid(), evidence);
  assert.equal(result.requires_human_review, true);
  assert.equal(result.entities.vehicle_number, 'XYZ123');
});
test('rejects malformed, unsupported, conflicting and invented structured fields', () => {
  for (const patch of [
    { confidence: 1.01 },
    { confidence: NaN },
    { confidence: '0.9' },
    { category: 'BOGUS' },
    { subcategory: 'DRIVER_NOT_FOUND' },
    { port: 'NORTHPORT' },
    { language: 'ZH' },
    { urgency: 'URGENT' },
    { recommended_action: 'SEND_EMAIL' },
    { requires_human_review: 'false' },
    { short_explanation: 'x'.repeat(501) },
    { hidden_reasoning: 'secret' },
    { generated_reply: 'hello' },
    { entities: {} },
  ])
    assert.throws(
      () => validateClassification({ ...valid(), ...patch }, evidence),
      AnalysisError,
    );
  assert.throws(
    () =>
      validateClassification(
        {
          ...valid(),
          entities: { ...valid().entities, vehicle_number: 'INVENTED' },
        },
        evidence,
      ),
    AnalysisError,
  );
});
test('accepts unknown fields through explicit enum/null fallback and avoids unnecessary driver identifiers', () => {
  const result = validateClassification(
    {
      ...valid(),
      category: 'OTHER',
      subcategory: null,
      port: 'UNKNOWN',
      language: 'UNKNOWN',
      entities: { ...valid().entities, driver_identifier: 'XYZ123' },
    },
    evidence,
  );
  assert.equal(result.entities.driver_identifier, null);
});
test('bounds context and removes email addresses, explicit secrets and quoted signatures', () => {
  const raw =
    'Vehicle XYZ123 at Westport\nEmail person@example.com\npassword: multi word secret\n--\nSignature\nOn Tuesday wrote:\nold';
  const text = redactText(raw);
  assert.ok(!text.includes('person@example.com'));
  assert.ok(!text.includes('multi word secret'));
  assert.ok(!text.includes('Signature'));
  const messages = Array.from(
    { length: 10 },
    () =>
      ({ direction: 'INBOUND', body_text: 'x'.repeat(5000) }) as SupportMessage,
  );
  const context = analysisContext('z'.repeat(500), messages);
  assert.equal(context.subject.length, 300);
  assert.equal(context.conversation.length, 6);
  assert.equal(context.conversation[0].text.length, 3000);
  assert.throws(
    () =>
      analysisContext('', [
        { direction: 'INBOUND', body_text: '' } as SupportMessage,
      ]),
    AnalysisError,
  );
});
test('missing server model configuration fails gracefully without a provider call', () => {
  const prior = process.env.GEMINI_SUPPORT_MODEL;
  delete process.env.GEMINI_SUPPORT_MODEL;
  try {
    assert.throws(
      classificationConfig,
      (error: unknown) =>
        error instanceof AnalysisError && error.status === 503,
    );
  } finally {
    if (prior !== undefined) process.env.GEMINI_SUPPORT_MODEL = prior;
  }
});
test('analysis APIs guard admin sessions and method before database or provider access', async () => {
  for (const [handler, method] of [
    [analyze, 'POST'],
    [analysis, 'GET'],
  ] as const) {
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
    assert.equal(code, 401);
    await handler(
      { method: 'DELETE', headers: {}, query: {} } as Request,
      response as unknown as Response,
    );
    assert.equal(code, 405);
  }
});
