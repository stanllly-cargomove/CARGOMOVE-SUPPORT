// Routed through the single Express Vercel function.
import { bodyOf, configuredClient, createPreviewToken, noStore, renderWelcomeTemplate, requireAdmin } from '../_email.js';

export default async function preview(request: any, response: any) {
  noStore(response);
  if (request.method !== 'POST') return response.status(405).json({ error: 'Method not allowed.' });
  const session = requireAdmin(request, response);
  if (!session) return;
  const client = configuredClient(response);
  if (!client) return;
  const body: Record<string, unknown> = await bodyOf(request).catch(() => ({}));
  const userId = String(body.userId || '').trim();
  if (!userId) return response.status(400).json({ error: 'A user ID is required.' });

  const userResult = await client.from('external_user_access').select('id,email,username,password,status,rejection_reason,rejection_detail,email_status').eq('id', userId).maybeSingle();
  if (userResult.error) return response.status(502).json({ error: userResult.error.message });
  if (!userResult.data) return response.status(404).json({ error: 'User registration not found.' });
  if (!['DONE', 'REJECTED'].includes(userResult.data.status)) return response.status(409).json({ error: 'Set the user registration status to DONE or REJECTED before previewing the email.' });
  let templateQuery = client.from('email_templates').select('*').eq('active', true).eq('trigger_status', userResult.data.status);
  if (userResult.data.status === 'REJECTED') {
    if (!userResult.data.rejection_reason) return response.status(409).json({ error: 'Select a rejection reason before previewing the email.' });
    templateQuery = templateQuery.eq('rejection_reason', userResult.data.rejection_reason);
  }
  const templateResult = await templateQuery.order('updated_at', { ascending: false }).limit(1).maybeSingle();
  if (templateResult.error) return response.status(502).json({ error: templateResult.error.message });
  if (!templateResult.data) return response.status(409).json({ error: `No active ${userResult.data.status.toLowerCase()} email template is configured.` });

  try {
    const rendered = renderWelcomeTemplate(templateResult.data, userResult.data);
    response.json({
      ...rendered,
      attachments: templateResult.data.attachments || [],
      templateName: templateResult.data.name,
      previewToken: createPreviewToken(session, userResult.data, templateResult.data),
    });
  } catch (error) {
    response.status(400).json({ error: error instanceof Error ? error.message : 'Unable to render the email.' });
  }
}
