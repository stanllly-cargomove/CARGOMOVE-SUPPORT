import { bodyOf, configuredClient, createRawMessage, decryptRefreshToken, emailHtmlToText, exchangeRefreshToken, noStore, publicError, requireAdmin, sanitizeEmailHtml, verifySubmissionPreviewToken } from '../_email.js';
import { assetRegistrationPdfName, buildAssetRegistrationPdf } from './submission-asset-pdf.js';

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

  const [submissionResult, connectionResult] = await Promise.all([
    client.from('registration_submissions').select('status,registration_type,reference_no,company_name,data').eq('id', token.submissionId).maybeSingle(),
    client.from('gmail_connections').select('*').eq('id', 'system').eq('status', 'ACTIVE').maybeSingle(),
  ]);
  const readError = submissionResult.error || connectionResult.error;
  if (readError) return response.status(502).json({ error: readError.message });
  if (!submissionResult.data || !['DRIVER', 'TRAILER', 'VEHICLE'].includes(submissionResult.data.registration_type)) return response.status(404).json({ error: 'Asset registration submission not found.' });
  if (submissionResult.data.status !== token.status) return response.status(409).json({ error: 'The submission status changed. Generate a new preview.' });
  if (!connectionResult.data) return response.status(409).json({ error: 'Connect a Gmail account before sending.' });
  try {
    const accessToken = await exchangeRefreshToken(decryptRefreshToken(connectionResult.data));
    const gmailResponse = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ raw: createRawMessage(connectionResult.data.email, recipient, subject, messageBody, (() => { const data = buildAssetRegistrationPdf(submissionResult.data.company_name, [submissionResult.data]); return [{ path: 'generated/asset-registration-list.pdf', name: assetRegistrationPdfName([submissionResult.data]), content_type: 'application/pdf', size: data.length, data }]; })()) }),
    });
    const gmailMessage = await gmailResponse.json().catch(() => ({}));
    if (!gmailResponse.ok || !gmailMessage.id) throw new Error(String(gmailMessage.error?.status || gmailMessage.error?.message || 'gmail_send_failed'));
    response.json({ status: 'SENT', sentAt: new Date().toISOString(), gmailMessageId: gmailMessage.id });
  } catch (error) {
    const message = publicError(error);
    console.error('Asset registration email failed:', message);
    response.status(502).json({ error: 'Gmail could not send the email. The preview remains available for retry.' });
  }
}
