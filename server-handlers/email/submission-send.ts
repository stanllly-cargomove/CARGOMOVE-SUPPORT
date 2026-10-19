import { bodyOf, configuredClient, createRawMessage, decryptRefreshToken, EMAIL_ATTACHMENT_BUCKET, emailHtmlToText, exchangeRefreshToken, noStore, publicError, requireAdmin, sanitizeEmailHtml, validateTemplateAttachments, verifySubmissionPreviewToken } from '../_email.js';
import { assetRegistrationPdfName, buildAssetRegistrationPdf } from './submission-asset-pdf.js';
import { serviceRoleKey, supabaseUrl } from '../../api/_runtime.js';
import { isEmailTemplateForRegistration } from '../../src/utils/registrationEmailTemplates.js';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validRecipients(value: string) {
  const recipients = value.split(',').map((recipient) => recipient.trim().toLowerCase()).filter(Boolean);
  return recipients.length > 0 && recipients.every((recipient) => EMAIL_PATTERN.test(recipient) && !/[\r\n]/.test(recipient));
}

export default async function submissionSend(request: any, response: any) {
  noStore(response);
  if (request.method !== 'POST') return response.status(405).json({ error: 'Method not allowed.' });
  const session = requireAdmin(request, response);
  if (!session) return;
  const client = configuredClient(response);
  if (!client) return;
  const body: Record<string, unknown> = await bodyOf(request).catch(() => ({}));
  const token = verifySubmissionPreviewToken(String(body.previewToken || ''), session);
  if (!token) return response.status(400).json({ error: 'The email preview expired. Generate a new preview.' });
  const recipient = String(body.recipient || '').trim().toLowerCase();
  const subject = String(body.subject || '').trim();
  const messageBody = sanitizeEmailHtml(String(body.body || ''));
  if (recipient !== token.recipient || !validRecipients(recipient)) return response.status(400).json({ error: 'The recipient must match the preview.' });
  if (!subject || /[\r\n]/.test(subject) || subject.length > 998) return response.status(400).json({ error: 'A valid subject is required.' });
  if (!emailHtmlToText(messageBody) || messageBody.length > 100_000) return response.status(400).json({ error: 'A valid email body is required.' });

  const [submissionResult, templateResult, connectionResult] = await Promise.all([
    client.from('registration_submissions').select('status,registration_type,reference_no,company_id,company_name,port_id,data').eq('id', token.submissionId).maybeSingle(),
    client.from('email_templates').select('id,name,version,active,trigger_status,template_code,attachments').eq('id', token.templateId).maybeSingle(),
    client.from('gmail_connections').select('*').eq('id', 'system').eq('status', 'ACTIVE').maybeSingle(),
  ]);
  const readError = submissionResult.error || templateResult.error || connectionResult.error;
  if (readError) return response.status(502).json({ error: readError.message });
  if (!submissionResult.data || !['COMPANY', 'DRIVER', 'TRAILER', 'VEHICLE'].includes(submissionResult.data.registration_type)) return response.status(404).json({ error: 'Registration submission not found.' });
  if (submissionResult.data.status !== token.status) return response.status(409).json({ error: 'The submission status changed. Generate a new preview.' });
  const submissionPortId = ['jh-pg-ics', 'jh-pg-depot'].includes(submissionResult.data.port_id) ? 'johor-port' : submissionResult.data.port_id;
  if (submissionPortId !== token.portId) return response.status(409).json({ error: 'The submission port changed. Generate a new preview.' });
  if (submissionResult.data.registration_type === 'COMPANY' && token.status === 'DONE') {
    if (!submissionResult.data.company_id) return response.status(409).json({ error: 'This company registration has no linked User Registration.' });
    const { data: linkedUser, error: linkedUserError } = await client.from('external_user_access')
      .select('email,status').eq('company_id', submissionResult.data.company_id)
      .order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (linkedUserError) return response.status(502).json({ error: linkedUserError.message });
    if (linkedUser?.status !== 'DONE') return response.status(409).json({ error: 'Complete the linked User Registration before sending the company acceptance email.' });
    if (recipient !== String(linkedUser.email || '').trim().toLowerCase()) return response.status(409).json({ error: 'The linked user email changed. Generate a new preview.' });
  }
  if (submissionResult.data.registration_type === 'COMPANY' && token.status === 'REJECTED' && submissionResult.data.company_id) {
    const { data: linkedUser, error: linkedUserError } = await client.from('external_user_access')
      .select('status').eq('company_id', submissionResult.data.company_id)
      .order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (linkedUserError) return response.status(502).json({ error: linkedUserError.message });
    if (linkedUser && linkedUser.status !== 'REJECTED') return response.status(409).json({ error: 'The linked User Registration is no longer rejected. Generate a new preview.' });
  }
  const template = templateResult.data;
  if (!template?.active || !template.template_code || template.version !== token.templateVersion || template.trigger_status !== token.status) {
    return response.status(409).json({ error: 'The email code changed. Generate a new preview.' });
  }
  if (!isEmailTemplateForRegistration(template, submissionResult.data.registration_type)) return response.status(409).json({ error: 'This email code does not match the registration type. Generate a new preview.' });
  const { data: assignment, error: assignmentError } = await client.from('email_template_ports').select('port_id').eq('template_id', template.id).eq('port_id', token.portId).maybeSingle();
  if (assignmentError) return response.status(502).json({ error: assignmentError.message });
  if (!assignment) return response.status(409).json({ error: 'This code is no longer assigned to the submission port.' });
  if (!connectionResult.data) return response.status(409).json({ error: 'Connect a Gmail account before sending.' });
  let attachmentMetadata;
  try { attachmentMetadata = validateTemplateAttachments(template.attachments || []); }
  catch (error) { return response.status(409).json({ error: error instanceof Error ? error.message : 'The template attachments are invalid.' }); }
  try {
    if (attachmentMetadata.length && (!supabaseUrl || !serviceRoleKey)) throw new Error('Supabase Storage is not configured.');
    const attachments = [];
    let downloadedBytes = 0;
    for (const attachment of attachmentMetadata) {
      const encodedPath = attachment.path.split('/').map(encodeURIComponent).join('/');
      const fileResponse = await fetch(`${supabaseUrl}/storage/v1/object/${EMAIL_ATTACHMENT_BUCKET}/${encodedPath}`, {
        headers: { apikey: serviceRoleKey!, Authorization: `Bearer ${serviceRoleKey}` },
      });
      if (!fileResponse.ok) throw new Error(`Attachment is unavailable: ${attachment.name}`);
      const data = Buffer.from(await fileResponse.arrayBuffer());
      downloadedBytes += data.length;
      if (downloadedBytes > 15 * 1024 * 1024 || data.length !== attachment.size) throw new Error(`Attachment size changed: ${attachment.name}`);
      attachments.push({ ...attachment, data });
    }
    if (submissionResult.data.registration_type !== 'COMPANY') {
      const pdf = buildAssetRegistrationPdf(submissionResult.data.company_name, [submissionResult.data]);
      attachments.push({ path: 'generated/asset-registration-list.pdf', name: assetRegistrationPdfName([submissionResult.data]), content_type: 'application/pdf', size: pdf.length, data: pdf });
    }
    const accessToken = await exchangeRefreshToken(decryptRefreshToken(connectionResult.data));
    const gmailResponse = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ raw: createRawMessage(connectionResult.data.email, recipient, subject, messageBody, attachments) }),
    });
    const gmailMessage = await gmailResponse.json().catch(() => ({}));
    if (!gmailResponse.ok || !gmailMessage.id) throw new Error(String(gmailMessage.error?.status || gmailMessage.error?.message || 'gmail_send_failed'));
    response.json({ status: 'SENT', sentAt: new Date().toISOString(), gmailMessageId: gmailMessage.id });
  } catch (error) {
    const message = publicError(error);
    console.error('Registration email failed:', message);
    response.status(502).json({ error: 'Gmail could not send the email. The preview remains available for retry.' });
  }
}
