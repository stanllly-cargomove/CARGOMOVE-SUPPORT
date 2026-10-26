import { createSubmissionPreviewHandler } from '../email/submission-preview.js';
import { createSubmissionSendHandler } from '../email/submission-send.js';
import { exchangeRefreshToken, decryptRefreshToken } from '../_email.js';
import { ASSET_ACCEPTANCE_TEMPLATES, isEmailTemplateForRegistration } from '../../src/utils/registrationEmailTemplates.js';

function capture() {
  return { code: 200, body: null as any, setHeader() {}, status(code: number) { this.code = code; return this; },
    json(body: any) { this.body = body; return this; } };
}

// Use the same rendering, recipients, PDF, Gmail and completion checks as the UI.
export async function completeAutoRegistrationEmails(client: any, session: any, deadline: number,
  handlers = {
    preview: createSubmissionPreviewHandler({ configuredClient: () => client, requireAdmin: () => session }),
    send: createSubmissionSendHandler({ configuredClient: () => client, requireAdmin: () => session, exchangeRefreshToken, decryptRefreshToken, fetch }),
  }, attempted = new Set<string>()) {
  const candidates = await client.rpc('auto_register_cm_email_candidates', {});
  if (candidates.error) throw new Error('Unable to load automatic acceptance emails. Apply the email completion migration.');
  let completed = 0;
  const issues: string[] = [];
  for (const submission of candidates.data || []) {
    if (Date.now() + 25_000 >= deadline) break;
    if (attempted.has(submission.id)) continue;
    attempted.add(submission.id);
    try {
      // Persisted Gmail acknowledgements can complete even if templates or Gmail
      // configuration changed after sending. Never send that message again.
      const receipt = await client.from('registration_acceptance_deliveries').select('state')
        .eq('submission_id', submission.id).eq('upload_id', submission.cargomove_upload.id).timeout(8000).maybeSingle();
      if (receipt.error) throw new Error('Unable to inspect acceptance email receipt.');
      if (receipt.data?.state === 'SENDING') throw new Error('An earlier email send is still in progress or has an uncertain outcome. Review Gmail Sent before retrying; no new email was sent. [GMAIL_SEND_UNCERTAIN]');
      if (receipt.data?.state === 'SENT') {
        const saved = await client.rpc('complete_registration_email', { p_submission_id: submission.id, p_upload_id: submission.cargomove_upload.id });
        if (saved.error) throw new Error('Email sent; registration completion needs retry.');
        completed++; continue;
      }
      const portId = ['jh-pg-ics', 'jh-pg-depot'].includes(submission.port_id) ? 'johor-port' : submission.port_id;
      const assigned = await client.from('email_template_ports').select('email_templates(*)').eq('port_id', portId).timeout(8000);
      if (assigned.error) throw new Error('Unable to load the acceptance email code.');
      const templates = (assigned.data || []).map((row: any) => row.email_templates)
        .filter((template: any) => template?.active && template.trigger_status === 'DONE' && template.template_code
          && isEmailTemplateForRegistration(template, submission.registration_type));
      const builtin = ASSET_ACCEPTANCE_TEMPLATES.find(template => template.type === submission.registration_type)?.id;
      const template = templates.find((template: any) => template.id === builtin) || (templates.length === 1 ? templates[0] : null);
      if (!template) throw new Error('Configure one acceptance email code for this registration type and port.');
      const preview = capture();
      await handlers.preview({ method: 'POST', body: { submissionId: submission.id, status: 'DONE', templateId: template.id, portId } }, preview);
      if (preview.code >= 400) throw new Error(preview.body?.error || 'Acceptance email preview failed.');
      const sent = capture();
      await handlers.send({ method: 'POST', body: preview.body }, sent);
      if (sent.code >= 400 || sent.body?.warning || sent.body?.status !== 'SENT') throw new Error(sent.body?.error || sent.body?.warning || 'Acceptance email failed.');
      completed++;
    } catch (error) {
      issues.push(`${submission.reference_no}: ${error instanceof Error ? error.message : 'Acceptance email needs review.'}`);
    }
  }
  return { completed, issues };
}
