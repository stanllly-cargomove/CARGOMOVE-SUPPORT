import { bodyOf, configuredClient, createSubmissionPreviewToken, noStore, requireAdmin, sanitizeEmailHtml } from '../_email.js';

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

export default async function submissionPreview(request: any, response: any) {
  noStore(response);
  if (request.method !== 'POST') return response.status(405).json({ error: 'Method not allowed.' });
  const session = requireAdmin(request, response);
  if (!session) return;
  const client = configuredClient(response);
  if (!client) return;
  const body: Record<string, unknown> = await bodyOf(request).catch(() => ({}));
  const submissionId = String(body.submissionId || '').trim();
  const status = String(body.status || '').trim().toUpperCase();
  if (!submissionId || !['DONE', 'REJECTED'].includes(status)) return response.status(400).json({ error: 'A completed or rejected submission is required.' });

  const result = await client.from('registration_submissions').select('id,reference_no,registration_type,company_id,company_name,submitted_by_email,notification_email,data').eq('id', submissionId).maybeSingle();
  if (result.error) return response.status(502).json({ error: result.error.message });
  const submission = result.data;
  if (!submission || !['DRIVER', 'TRAILER', 'VEHICLE'].includes(submission.registration_type)) return response.status(404).json({ error: 'Asset registration submission not found.' });
  const companyResult = submission.company_id
    ? await client.from('companies').select('contact_email,details').eq('id', submission.company_id).maybeSingle()
    : { data: null, error: null };
  if (companyResult.error) return response.status(502).json({ error: companyResult.error.message });
  const recipients = recipientsFor(submission, companyResult.data);
  if (!recipients.length) return response.status(409).json({ error: 'This submission has no valid notification email address.' });
  const recipient = recipients.join(', ');
  const assetLabel = submission.registration_type.charAt(0) + submission.registration_type.slice(1).toLowerCase();
  const isApproved = status === 'DONE';
  const subject = `CargoMove ${assetLabel.toLowerCase()} registration ${isApproved ? 'approved' : 'rejected'} — ${submission.reference_no}`;
  const bodyHtml = isApproved
    ? `<p>Dear Customer,</p><p>Your ${assetLabel.toLowerCase()} registration for <strong>${submission.company_name}</strong> has been approved.</p><p>Reference number: <strong>${submission.reference_no}</strong></p><p>Your registration is now complete.</p><p>Regards,<br>CargoMove</p>`
    : `<p>Dear Customer,</p><p>We are unable to proceed with your ${assetLabel.toLowerCase()} registration for <strong>${submission.company_name}</strong>.</p><p>Reference number: <strong>${submission.reference_no}</strong></p><p>Please contact CargoMove Support if you need more information.</p><p>Regards,<br>CargoMove</p>`;
  response.json({
    recipient,
    subject,
    body: sanitizeEmailHtml(bodyHtml),
    templateName: `${assetLabel} Registration — ${isApproved ? 'Approved' : 'Rejected'}`,
    attachments: [],
    previewToken: createSubmissionPreviewToken(session, submission.id, status as 'DONE' | 'REJECTED', recipient),
  });
}
