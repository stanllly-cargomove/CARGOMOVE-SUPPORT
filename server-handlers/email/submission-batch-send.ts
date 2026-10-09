import { bodyOf, configuredClient, createRawMessage, decryptRefreshToken, emailHtmlToText, exchangeRefreshToken, noStore, publicError, requireAdmin, sanitizeEmailHtml, verifySubmissionBatchPreviewToken } from '../_email.js';
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export default async function submissionBatchSend(request: any, response: any) {
  noStore(response); if (request.method !== 'POST') return response.status(405).json({ error: 'Method not allowed.' });
  const session = requireAdmin(request, response); if (!session) return;
  const client = configuredClient(response); if (!client) return;
  const body: Record<string, unknown> = await bodyOf(request).catch(() => ({}));
  const token = verifySubmissionBatchPreviewToken(String(body.previewToken || ''), session);
  if (!token) return response.status(400).json({ error: 'The email preview expired. Generate a new preview.' });
  const recipient = String(body.recipient || '').trim().toLowerCase(); const subject = String(body.subject || '').trim(); const message = sanitizeEmailHtml(String(body.body || ''));
  if (recipient !== token.recipient || !recipient.split(',').every((email) => EMAIL.test(email.trim())) || !subject || /[\r\n]/.test(subject) || !emailHtmlToText(message)) return response.status(400).json({ error: 'The email preview is invalid.' });
  const [submissionResults, connectionResult] = await Promise.all([Promise.all(token.submissionIds.map((id) => client.from('registration_submissions').select('id,status,registration_type').eq('id', id).maybeSingle())), client.from('gmail_connections').select('*').eq('id', 'system').eq('status', 'ACTIVE').maybeSingle()]);
  const submissionError = submissionResults.find((result) => result.error)?.error;
  if (submissionError || connectionResult.error) return response.status(502).json({ error: submissionError?.message || connectionResult.error?.message });
  const submissions = submissionResults.map((result) => result.data).filter(Boolean);
  if (submissions.length !== token.submissionIds.length || submissions.some((submission: any) => submission.status !== 'DONE' || !['DRIVER', 'TRAILER', 'VEHICLE'].includes(submission.registration_type))) return response.status(409).json({ error: 'A registration status changed. Generate a new preview.' });
  if (!connectionResult.data) return response.status(409).json({ error: 'Connect a Gmail account before sending.' });
  try { const accessToken = await exchangeRefreshToken(decryptRefreshToken(connectionResult.data)); const gmailResponse = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', { method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ raw: createRawMessage(connectionResult.data.email, recipient, subject, message) }) }); const result = await gmailResponse.json().catch(() => ({})); if (!gmailResponse.ok || !result.id) throw new Error('gmail_send_failed'); response.json({ status: 'SENT', sentAt: new Date().toISOString(), gmailMessageId: result.id }); } catch (error) { console.error('Batch registration email failed:', publicError(error)); response.status(502).json({ error: 'Gmail could not send the email. The preview remains available for retry.' }); }
}
