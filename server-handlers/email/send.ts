// Routed through the single Express Vercel function.
import {
  bodyOf,
  configuredClient,
  createRawMessage,
  EMAIL_ATTACHMENT_BUCKET,
  decryptRefreshToken,
  exchangeRefreshToken,
  noStore,
  publicError,
  requireAdmin,
  validateTemplateAttachments,
  verifyPreviewToken,
} from '../_email.js';
import { serviceRoleKey, supabaseUrl } from '../../api/_runtime.js';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default async function sendEmail(request: any, response: any) {
  noStore(response);
  if (request.method !== 'POST') return response.status(405).json({ error: 'Method not allowed.' });
  const session = requireAdmin(request, response);
  if (!session) return;
  const client = configuredClient(response);
  if (!client) return;
  const body: Record<string, unknown> = await bodyOf(request).catch(() => ({}));
  const previewToken = String(body.previewToken || '');
  const token = verifyPreviewToken(previewToken, session);
  if (!token) return response.status(400).json({ error: 'The email preview expired. Generate a new preview.' });

  const recipient = String(body.recipient || '').trim().toLowerCase();
  const subject = String(body.subject || '').trim();
  const messageBody = String(body.body || '');
  if (!EMAIL_PATTERN.test(recipient) || /[\r\n]/.test(recipient)) return response.status(400).json({ error: 'A valid recipient is required.' });
  if (!subject || /[\r\n]/.test(subject) || subject.length > 998) return response.status(400).json({ error: 'A valid subject is required.' });
  if (!messageBody || messageBody.length > 100_000) return response.status(400).json({ error: 'A valid email body is required.' });

  const [userResult, templateResult, connectionResult] = await Promise.all([
    client.from('external_user_access').select('id,email,status,email_status').eq('id', token.userId).maybeSingle(),
    client.from('email_templates').select('id,name,version,active,attachments').eq('id', token.templateId).maybeSingle(),
    client.from('gmail_connections').select('*').eq('id', 'system').eq('status', 'ACTIVE').maybeSingle(),
  ]);
  const readError = userResult.error || templateResult.error || connectionResult.error;
  if (readError) return response.status(502).json({ error: readError.message });
  const user = userResult.data;
  const template = templateResult.data;
  const connection = connectionResult.data;
  if (!user || user.status !== 'DONE') return response.status(409).json({ error: 'The user registration must still be DONE.' });
  if (recipient !== String(user.email).toLowerCase()) return response.status(400).json({ error: 'The recipient must match the registered user email.' });
  if (!template?.active || template.version !== token.templateVersion) return response.status(409).json({ error: 'The email template changed. Generate a new preview.' });
  if (!connection) return response.status(409).json({ error: 'Connect a Gmail account before sending.' });
  if (user.email_status === 'SENDING') return response.status(409).json({ error: 'This email is already being sent.' });

  let attachmentMetadata;
  try {
    attachmentMetadata = validateTemplateAttachments(template.attachments || []);
  } catch (error) {
    return response.status(409).json({ error: error instanceof Error ? error.message : 'The template attachments are invalid.' });
  }

  const { data: claimed, error: claimError } = await client
    .from('external_user_access')
    .update({ email_status: 'SENDING' })
    .eq('id', user.id)
    .neq('email_status', 'SENDING')
    .select('id')
    .maybeSingle();
  if (claimError || !claimed) return response.status(409).json({ error: claimError?.message || 'This email is already being sent.' });

  const { data: log, error: logError } = await client.from('email_logs').insert({
    external_user_id: user.id,
    template_id: template.id,
    template_name: template.name,
    template_version: template.version,
    recipient,
    subject,
    attachments: attachmentMetadata,
    sent_by: session.id,
    sent_by_email: session.email,
    status: 'SENDING',
  }).select('id').single();
  if (logError) {
    await client.from('external_user_access').update({ email_status: 'FAILED', email_sent: 0 }).eq('id', user.id);
    return response.status(502).json({ error: logError.message });
  }

  try {
    if (!supabaseUrl || !serviceRoleKey) throw new Error('Supabase Storage is not configured.');
    const attachments = [];
    let downloadedBytes = 0;
    for (const attachment of attachmentMetadata) {
      const encodedPath = attachment.path.split('/').map(encodeURIComponent).join('/');
      const fileResponse = await fetch(`${supabaseUrl}/storage/v1/object/${EMAIL_ATTACHMENT_BUCKET}/${encodedPath}`, {
        headers: { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}` },
      });
      if (!fileResponse.ok) throw new Error(`Attachment is unavailable: ${attachment.name}`);
      const contentLength = Number(fileResponse.headers.get('content-length') || 0);
      if (contentLength && (contentLength !== attachment.size || downloadedBytes + contentLength > 15 * 1024 * 1024)) {
        throw new Error(`Attachment size changed: ${attachment.name}`);
      }
      const data = Buffer.from(await fileResponse.arrayBuffer());
      downloadedBytes += data.length;
      if (downloadedBytes > 15 * 1024 * 1024) throw new Error('Template attachments exceed the 15 MB total limit.');
      if (data.length !== attachment.size) throw new Error(`Attachment size changed: ${attachment.name}`);
      attachments.push({ ...attachment, data });
    }
    const accessToken = await exchangeRefreshToken(decryptRefreshToken(connection));
    const gmailResponse = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ raw: createRawMessage(connection.email, recipient, subject, messageBody, attachments) }),
    });
    const gmailMessage = await gmailResponse.json().catch(() => ({}));
    if (!gmailResponse.ok || !gmailMessage.id) throw new Error(String(gmailMessage.error?.status || gmailMessage.error?.message || 'gmail_send_failed'));
    const sentAt = new Date().toISOString();
    await Promise.all([
      client.from('email_logs').update({
        status: 'SENT',
        sent_at: sentAt,
        gmail_message_id: String(gmailMessage.id),
        gmail_thread_id: gmailMessage.threadId ? String(gmailMessage.threadId) : null,
      }).eq('id', log.id),
      client.from('external_user_access').update({ email_status: 'SENT', email_sent: 1 }).eq('id', user.id),
    ]);
    response.json({ status: 'SENT', sentAt, gmailMessageId: gmailMessage.id });
  } catch (error) {
    const message = publicError(error);
    console.error('Gmail send failed:', message);
    await Promise.all([
      client.from('email_logs').update({ status: 'FAILED', error_code: 'GMAIL_SEND_FAILED', error_message: message }).eq('id', log.id),
      client.from('external_user_access').update({ email_status: 'FAILED', email_sent: 0 }).eq('id', user.id),
      client.from('gmail_connections').update({ last_error_code: message }).eq('id', 'system'),
    ]);
    response.status(502).json({ error: 'Gmail could not send the email. The preview remains available for retry.' });
  }
}
