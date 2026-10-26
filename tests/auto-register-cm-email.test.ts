import test from 'node:test';
import assert from 'node:assert/strict';
import { completeAutoRegistrationEmails } from '../server-handlers/scheduler/auto-register-cm-email.js';
import { createSubmissionPreviewHandler } from '../server-handlers/email/submission-preview.js';
import { createSubmissionSendHandler } from '../server-handlers/email/submission-send.js';

test('automatic verified trailer and vehicle emails use assigned codes, recipients and PDFs and close Pending only after Gmail acknowledges', async () => {
  const previous = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = 'offline-auto-email-signing-key';
  try {
    const subs = ['TRAILER', 'VEHICLE'].map((type, i) => ({ id: `s${i}`, registration_type: type, reference_no: `CMREG${i}`,
      status: 'PENDING', company_id: 'company', company_name: 'Offline Carrier', port_id: 'jh-pg-depot',
      notification_email: 'queue@example.test', submitted_by_email: 'submitter@example.test', data: {},
      cargomove_upload: { state: 'SUCCESS', id: `90000000-0000-4000-8000-00000000000${i}` } }));
    const templates = subs.map(sub => ({ id: `acceptance-${sub.registration_type.toLowerCase()}`, registration_type: sub.registration_type,
      name: 'Acceptance', active: true, trigger_status: 'DONE', template_code: sub.registration_type, version: 1,
      attachments: [], recipient_template: '{{user.email}}', subject_template: `${sub.registration_type} accepted`, body_template: '<p>Approved.</p>' }));
    const receipts = new Map<string, any>();
    const sends: string[] = [];
    let failGmail = false;
    const client = {
      async rpc(name: string, args: any) {
        if (name === 'auto_register_cm_email_candidates') return { data: subs.filter(sub => sub.status === 'PENDING'), error: null };
        if (name === 'claim_registration_acceptance') {
          if (receipts.has(args.p_submission_id)) return { data: receipts.get(args.p_submission_id).state, error: null };
          receipts.set(args.p_submission_id, { state: 'SENDING' }); return { data: 'CLAIMED', error: null };
        }
        assert.equal(name, 'complete_registration_email');
        assert.equal(receipts.get(args.p_submission_id).state, 'SENT');
        const sub = subs.find(sub => sub.id === args.p_submission_id)!;
        sub.status = 'DONE'; return { data: sub, error: null };
      },
      from(table: string) {
        const filters = new Map<string, any>(); let update: any;
        const q: any = { select() { return this; }, eq(key: string, value: any) { filters.set(key, value); return this; },
          not() { return this; }, timeout() { return this; }, update(value: any) { update = value; return this; },
          async maybeSingle() {
            const data = table === 'registration_submissions' ? subs.find(sub => sub.id === filters.get('id'))
              : table === 'registration_acceptance_deliveries' ? receipts.get(filters.get('submission_id')) || null
              : table === 'email_templates' ? templates.find(template => template.id === filters.get('id'))
              : table === 'gmail_connections' ? { email: 'sender@example.test' }
              : table === 'companies' ? { contact_email: 'contact@example.test', details: {} }
              : { port_id: 'johor-port' };
            return { data, error: null };
          },
          then(resolve: any, reject: any) {
            if (table === 'registration_acceptance_deliveries') receipts.set(filters.get('submission_id'), update);
            const data = table === 'email_template_ports' ? templates.map(template => ({ email_templates: template })) : [{ submission_id: filters.get('submission_id') }];
            return Promise.resolve({ data, error: null }).then(resolve, reject);
          },
        }; return q;
      },
    };
    const session = { id: 'admin', email: 'admin@example.test', type: 'ADMIN', exp: Date.now() + 60000 };
    const handlers = {
      preview: createSubmissionPreviewHandler({ configuredClient: () => client as any, requireAdmin: () => session }),
      send: createSubmissionSendHandler({ configuredClient: () => client as any, requireAdmin: () => session,
        exchangeRefreshToken: async () => 'offline-token', decryptRefreshToken: () => 'offline-token',
        fetch: (async (_url: any, init: any) => {
          assert.ok(subs.some(sub => sub.status === 'PENDING'), 'Gmail acknowledges before Pending closes');
          sends.push(Buffer.from(JSON.parse(init.body).raw, 'base64url').toString());
          if (failGmail) throw new Error('Offline network timeout after dispatch');
          return new Response(JSON.stringify({ id: `gmail-${sends.length}` }));
        }) as typeof fetch }),
    };
    const result = await completeAutoRegistrationEmails(client, session, Date.now() + 100_000, handlers);
    assert.deepEqual(result, { completed: 2, issues: [] });
    assert.ok(subs.every(sub => sub.status === 'DONE'));
    assert.equal(sends.length, 2);
    for (const mime of sends) {
      assert.match(mime, /To: contact@example.test, queue@example.test, submitter@example.test/);
      assert.match(mime, /application\/pdf/);
    }
    await completeAutoRegistrationEmails(client, session, Date.now() + 100_000, handlers);
    assert.equal(sends.length, 2, 'Repeated executions never resend completed acceptance emails');

    subs[0].status = 'PENDING'; templates[0].active = false;
    assert.equal((await completeAutoRegistrationEmails(client, session, Date.now() + 100_000, handlers)).completed, 1);
    assert.equal(sends.length, 2, 'A saved Gmail receipt completes even after its template is disabled');
    assert.equal(subs[0].status, 'DONE');
    subs[0].status = 'PENDING'; receipts.delete(subs[0].id);
    assert.equal((await completeAutoRegistrationEmails(client, session, Date.now() + 100_000, handlers)).issues.length, 1);
    assert.equal(subs[0].status, 'PENDING', 'Missing acceptance code does not close or email the submission');
    assert.equal(sends.length, 2);
    templates[0].active = true;

    // An interrupted send remains Pending and holds its claim on the next run.
    subs[0].status = 'PENDING'; receipts.delete(subs[0].id); failGmail = true;
    assert.equal((await completeAutoRegistrationEmails(client, session, Date.now() + 100_000, handlers)).issues.length, 1);
    assert.equal(receipts.get(subs[0].id).state, 'SENDING');
    failGmail = false;
    await completeAutoRegistrationEmails(client, session, Date.now() + 100_000, handlers);
    assert.equal(sends.length, 3, 'Ambiguous sends cannot be replayed');
    assert.equal(subs[0].status, 'PENDING');
  } finally { if (previous === undefined) delete process.env.SESSION_SECRET; else process.env.SESSION_SECRET = previous; }
});
