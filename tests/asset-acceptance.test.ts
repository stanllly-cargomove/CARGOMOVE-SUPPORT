import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { test } from 'node:test';
import preview from '../server-handlers/email/submission-preview.js';
import attachment from '../server-handlers/email/submission-attachment.js';
import { ASSET_ACCEPTANCE_TEMPLATES, isEmailTemplateForRegistration } from '../src/utils/registrationEmailTemplates.js';

test('asset acceptance previews use the matching code and retain a downloadable registration PDF', async () => {
  const originalFetch = globalThis.fetch;
  const savedEnv = { SESSION_SECRET: process.env.SESSION_SECRET, SUPABASE_URL: process.env.SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY };
  Object.assign(process.env, { SESSION_SECRET: 'offline-test-secret', SUPABASE_URL: 'https://supabase.example.test', SUPABASE_SERVICE_ROLE_KEY: 'offline-key' });
  const encoded = Buffer.from(JSON.stringify({ id: 'admin', type: 'ADMIN', exp: Date.now() + 60000 })).toString('base64url');
  const cookie = `cargomove_session=${encoded}.${crypto.createHmac('sha256', process.env.SESSION_SECRET!).update(encoded).digest('base64url')}`;
  const response = (): any => ({ statusCode: 200, body: null, headers: {}, setHeader(key: string, value: string) { this.headers[key] = value; }, status(code: number) { this.statusCode = code; return this; }, json(body: unknown) { this.body = body; }, send(body: unknown) { this.body = body; } });
  try {
    for (const definition of ASSET_ACCEPTANCE_TEMPLATES) {
      const submission = {
        id: 's1', reference_no: 'CMREG400173', registration_type: definition.type, company_name: 'TEST COMPANY',
        port_id: 'johor-port', status: 'DONE', submitted_by_email: 'customer@example.test',
        data: { drivers: [{ name: 'TEST DRIVER', driving_license: 'D123', mobile_no: '0123456789' }], trailers: [{ registration_number: 'TRAILER123' }], vehicles: [{ registration_number: 'VEHICLE123' }] },
      };
      let templateId: string = definition.id;
      globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
        assert.ok(!init?.method || init.method === 'GET', 'preview and PDF must not write records or send email');
        const url = new URL(String(input));
        if (url.pathname.endsWith('/registration_submissions')) return Response.json([submission]);
        if (url.pathname.endsWith('/email_templates')) return Response.json([{ id: templateId, name: definition.label, template_code: 'ACC002', trigger_status: 'DONE', active: true, version: 1, recipient_template: '{{user.email}}', subject_template: 'Registration approved', body_template: '<p>Please see the attached PDF.</p>', attachments: [] }]);
        if (url.pathname.endsWith('/email_template_ports')) return Response.json([{ port_id: 'johor-port' }]);
        throw new Error(`Unexpected request: ${url.pathname}`);
      }) as typeof fetch;
      const result = response();
      await preview({ method: 'POST', headers: { cookie }, body: { submissionId: 's1', status: 'DONE', templateId, portId: 'johor-port' } }, result);
      assert.equal(result.statusCode, 200, JSON.stringify(result.body));
      assert.equal(result.body.attachments.length, 1);
      assert.equal(result.body.attachments[0].content_type, 'application/pdf');
      assert.equal(result.body.attachments[0].name, 'CMREG400173.pdf');
      assert.match(result.body.attachments[0].path, /submissionIds=s1/);
      const pdf = response();
      await attachment({ method: 'GET', headers: { cookie }, query: { submissionIds: 's1' } }, pdf);
      assert.equal(pdf.statusCode, 200);
      assert.equal(pdf.headers['Content-Type'], 'application/pdf');
      assert.equal(pdf.body.subarray(0, 5).toString(), '%PDF-');
      assert.ok(pdf.body.includes(Buffer.from(`${definition.label} Registration`)));
      assert.ok(pdf.body.includes(Buffer.from('CMREG400173')));
      const detail = definition.type === 'DRIVER' ? 'TEST DRIVER' : `${definition.type}123`;
      assert.ok(pdf.body.includes(Buffer.from(detail)), 'PDF contains the registered asset');
      for (const wrongType of ['COMPANY', 'DRIVER', 'TRAILER', 'VEHICLE'].filter((type) => type !== definition.type)) {
        assert.equal(isEmailTemplateForRegistration(definition, wrongType), false);
      }
      templateId = 'cargomove-welcome';
      const mismatch = response();
      await preview({ method: 'POST', headers: { cookie }, body: { submissionId: 's1', status: 'DONE', templateId, portId: 'johor-port' } }, mismatch);
      assert.equal(mismatch.statusCode, 409);
      assert.match(mismatch.body.error, /registration type/);
    }
    assert.equal(isEmailTemplateForRegistration({ id: 'custom-code' }, 'DRIVER'), true);
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});

