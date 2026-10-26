import { bodyOf, configuredClient, createSubmissionPreviewToken, noStore, renderWelcomeTemplate, requireAdmin } from '../_email.js';
import { assetRegistrationPdfName } from './submission-asset-pdf.js';
import { isEmailTemplateForRegistration } from '../../src/utils/registrationEmailTemplates.js';

function validEmail(value: unknown) {
  const email = String(value || '').trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '';
}

function recipientsFor(submission: any, company: any) {
  const recipientSet = new Set<string>();
  const add = (value: unknown) => {
    const email = validEmail(value);
    if (email) recipientSet.add(email);
  };
  // The Company Master contact and the optional queue address are both
  // deliberate notification recipients for asset registration outcomes.
  add(company?.contact_email);
  add(company?.details?.contact_email);
  add(submission?.notification_email);
  const savedRecipients = submission?.data?.email_confirmation?.recipients;
  if (Array.isArray(savedRecipients)) savedRecipients.forEach(add);
  add(submission?.submitted_by_email);
  return Array.from(recipientSet);
}

export function createSubmissionPreviewHandler(deps = { requireAdmin, configuredClient }) {
  return async function submissionPreview(request: any, response: any) {
    noStore(response);
    if (request.method !== 'POST') return response.status(405).json({ error: 'Method not allowed.' });
    const session = deps.requireAdmin(request, response);
    if (!session) return;
    const client = deps.configuredClient(response);
    if (!client) return;
    const body: Record<string, unknown> = await bodyOf(request).catch(() => ({}));
    const submissionId = String(body.submissionId || '').trim();
    const status = String(body.status || '').trim().toUpperCase();
    const templateId = String(body.templateId || '').trim();
    const portId = String(body.portId || '').trim();
    if (!submissionId || !['DONE', 'REJECTED'].includes(status) || !templateId || !portId) return response.status(400).json({ error: 'A submission, port, and email code are required.' });

    const result = await client.from('registration_submissions').select('id,reference_no,registration_type,company_id,company_name,port_id,status,cargomove_upload,submitted_by_name,submitted_by_email,notification_email,rejection_detail,data').eq('id', submissionId).maybeSingle();
    if (result.error) return response.status(502).json({ error: result.error.message });
    const submission = result.data;
    if (!submission || !['COMPANY', 'DRIVER', 'TRAILER', 'VEHICLE'].includes(submission.registration_type)) return response.status(404).json({ error: 'Registration submission not found.' });
    const pendingUploadId = status === 'DONE' && submission.status === 'PENDING' && submission.registration_type !== 'COMPANY'
      && submission.cargomove_upload?.state === 'SUCCESS' ? submission.cargomove_upload.id : undefined;
    if (status === 'DONE' && submission.status !== 'DONE' && !pendingUploadId) return response.status(409).json({ error: 'Verify the CargoMove upload before previewing its acceptance email.' });
    if (submission.registration_type === 'COMPANY' && status === 'DONE' && submission.status !== 'DONE') {
      return response.status(409).json({ error: 'Register the company before previewing its acceptance email.' });
    }
    const submissionPortId = ['jh-pg-ics', 'jh-pg-depot'].includes(submission.port_id) ? 'johor-port' : submission.port_id;
    if (!submissionPortId || submissionPortId !== portId) return response.status(409).json({ error: 'The selected code does not match this submission port.' });
    const [templateResult, assignmentResult] = await Promise.all([
      client.from('email_templates').select('*').eq('id', templateId).eq('active', true).eq('trigger_status', status).not('template_code', 'is', null).maybeSingle(),
      client.from('email_template_ports').select('port_id').eq('template_id', templateId).eq('port_id', portId).maybeSingle(),
    ]);
    if (templateResult.error || assignmentResult.error) return response.status(502).json({ error: templateResult.error?.message || assignmentResult.error?.message });
    if (!templateResult.data || !assignmentResult.data) return response.status(409).json({ error: 'This email code is not active for the submission port.' });
    if (!isEmailTemplateForRegistration(templateResult.data, submission.registration_type)) return response.status(409).json({ error: 'This email code does not match the registration type.' });
    const companyResult = submission.company_id
      ? await client.from('companies').select('contact_email,details').eq('id', submission.company_id).maybeSingle()
      : { data: null, error: null };
    if (companyResult.error) return response.status(502).json({ error: companyResult.error.message });
    const linkedUserResult = submission.registration_type === 'COMPANY' && submission.company_id
      ? await client.from('external_user_access').select('email,username,password,status').eq('company_id', submission.company_id).order('created_at', { ascending: false }).limit(1).maybeSingle()
      : { data: null, error: null };
    if (linkedUserResult.error) return response.status(502).json({ error: linkedUserResult.error.message });
    if (submission.registration_type === 'COMPANY' && status === 'DONE' && linkedUserResult.data?.status !== 'DONE') {
      return response.status(409).json({ error: 'Complete the linked User Registration before previewing the company acceptance email.' });
    }
    if (submission.registration_type === 'COMPANY' && status === 'REJECTED' && linkedUserResult.data && linkedUserResult.data.status !== 'REJECTED') {
      return response.status(409).json({ error: 'The linked User Registration must be rejected before previewing the company rejection email.' });
    }
    if (submission.registration_type === 'COMPANY' && status === 'DONE' && !validEmail(linkedUserResult.data?.email)) {
      return response.status(409).json({ error: 'The approved User Registration needs a valid email address.' });
    }
    const recipients = submission.registration_type === 'COMPANY'
      ? [status === 'DONE' ? validEmail(linkedUserResult.data?.email) : validEmail(linkedUserResult.data?.email) || validEmail(submission.submitted_by_email) || validEmail(submission.notification_email)].filter(Boolean)
      : recipientsFor(submission, companyResult.data);
    if (!recipients.length) return response.status(409).json({ error: 'This submission has no valid notification email address.' });
    const recipient = recipients.join(', ');
    try {
      const template = templateResult.data;
      const rendered = renderWelcomeTemplate(template, {
        id: submission.id,
        email: recipient,
        username: linkedUserResult.data?.username || submission.submitted_by_name || submission.company_name,
        password: submission.registration_type === 'COMPANY' && status === 'DONE' ? linkedUserResult.data.password : 'Not applicable',
        status: status as 'DONE' | 'REJECTED',
        rejection_detail: submission.rejection_detail || template.name,
        email_status: 'READY',
      });
      response.json({
        ...rendered,
        templateName: template.name,
        templateCode: template.template_code,
        portId,
        attachments: [...(template.attachments || []), ...(submission.registration_type === 'COMPANY' ? [] : [{ path: `/api/email/submission-attachment?submissionIds=${encodeURIComponent(submission.id)}`, name: assetRegistrationPdfName([submission]), content_type: 'application/pdf', size: 0 }])],
        previewToken: createSubmissionPreviewToken(session, submission.id, status as 'DONE' | 'REJECTED', recipient, template, portId, pendingUploadId),
      });
    } catch (error) {
      response.status(400).json({ error: error instanceof Error ? error.message : 'Unable to render the email code.' });
    }
  }
}

export default createSubmissionPreviewHandler();
