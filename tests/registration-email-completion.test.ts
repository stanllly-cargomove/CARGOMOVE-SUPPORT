import test from 'node:test';
import assert from 'node:assert/strict';
import { createSubmissionSendHandler } from '../server-handlers/email/submission-send.js';
import { createSubmissionPreviewToken } from '../server-handlers/_email.js';

test('only an acknowledged acceptance email closes its verified Pending registration', async () => {
  const previous = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = 'offline-fixture-signing-key';
  try {
    const session = { id: 'admin', email: 'admin@example.test', type: 'ADMIN', exp: Date.now() + 60000 };
    const uploadId = '90000000-0000-4000-8000-000000000001';
    const template = { id: 'acceptance-driver', name: 'Acceptance', active: true, trigger_status: 'DONE', template_code: 'A1', version: 1, attachments: [] } as any;
    let submission: any = { status: 'PENDING', registration_type: 'DRIVER', reference_no: 'CMREG400001', company_id: 'company', company_name: 'Offline Carrier', port_id: 'port', data: {}, cargomove_upload: { id: uploadId, state: 'SUCCESS' } };
    let gmailOk = false, completionError = false, gmailCalls = 0, completions = 0;
    let deliveryState: string | undefined;
    const handler = createSubmissionSendHandler({
      requireAdmin: () => session,
      configuredClient: () => ({ from(table: string) {
        let update: any;
        return { select() { return this; }, eq() { return this; }, update(value: any) { update = value; return this; },
        then(resolve: any, reject: any) {
          assert.equal(table, 'registration_acceptance_deliveries');
          deliveryState = update.state;
          return Promise.resolve({ data: [{ submission_id: 'driver' }], error: null }).then(resolve, reject);
        }, async maybeSingle() {
          return { error: null, data: table === 'registration_submissions' ? submission : table === 'email_templates' ? template
            : table === 'gmail_connections' ? { email: 'sender@example.test' } : { port_id: 'port' } };
        } };
      }, async rpc(name: string, args: any) {
        if (name === 'claim_registration_acceptance') {
          if (deliveryState === 'SENDING' || deliveryState === 'SENT') return { data: deliveryState, error: null };
          deliveryState = 'SENDING'; return { data: 'CLAIMED', error: null };
        }
        assert.equal(name, 'complete_registration_email'); assert.equal(gmailOk, true, 'No completion before Gmail acknowledges sending');
        assert.deepEqual(args, { p_submission_id: 'driver', p_upload_id: uploadId }); completions++;
        if (completionError) return { error: { message: 'Offline DB unavailable' } };
        submission.status = 'DONE'; return { data: submission, error: null };
      } }) as any,
      exchangeRefreshToken: async () => 'offline-token', decryptRefreshToken: () => 'offline-token',
      fetch: (async (url: any) => {
        assert.equal(url, 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send'); gmailCalls++;
        return new Response(JSON.stringify(gmailOk ? { id: 'offline-message' } : { error: 'rejected' }), { status: gmailOk ? 200 : 400 });
      }) as typeof fetch,
    });
    const previewToken = createSubmissionPreviewToken(session, 'driver', 'DONE', 'recipient@example.test', template, 'port', uploadId);
    const call = async () => {
      const res = { code: 200, body: null as any, setHeader() {}, status(code: number) { this.code = code; return this; }, json(body: any) { this.body = body; return this; } };
      await handler({ method: 'POST', body: { previewToken, recipient: 'recipient@example.test', subject: 'Approved', body: '<p>Approved.</p>' } }, res);
      return res;
    };
    assert.equal((await call()).code, 502); assert.equal(submission.status, 'PENDING'); assert.equal(completions, 0);
    gmailOk = true;
    assert.equal((await call()).body.status, 'SENT'); assert.equal(submission.status, 'DONE'); assert.equal(completions, 1);
    assert.equal((await call()).code, 409); assert.equal(gmailCalls, 2, 'A completed preview cannot send again');
    submission = { ...submission, status: 'PENDING', cargomove_upload: { id: uploadId, state: 'FAILED' } };
    assert.equal((await call()).code, 409); assert.equal(gmailCalls, 2);
    submission.cargomove_upload.state = 'SUCCESS'; completionError = true; deliveryState = undefined;
    const warning = await call();
    assert.equal(warning.body.status, 'SENT'); assert.match(warning.body.warning, /Email sent/); assert.equal(submission.status, 'PENDING');
    const sendsBeforeRecovery = gmailCalls;
    completionError = false;
    assert.equal((await call()).body.recovered, true);
    assert.equal(submission.status, 'DONE');
    assert.equal(gmailCalls, sendsBeforeRecovery, 'Recover completion using the saved Gmail receipt without resending');
    submission.status = 'PENDING'; deliveryState = 'SENDING';
    assert.equal((await call()).code, 409);
    assert.equal(gmailCalls, sendsBeforeRecovery, 'An in-progress or ambiguous send cannot be replayed');
  } finally { if (previous === undefined) delete process.env.SESSION_SECRET; else process.env.SESSION_SECRET = previous; }
});
