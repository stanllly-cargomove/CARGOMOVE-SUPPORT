import { bodyOf, configuredClient, createPreviewToken, noStore, renderWelcomeTemplate, requireAdmin, WELCOME_TEMPLATE_ID } from '../_email';

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

  const [userResult, templateResult] = await Promise.all([
    client.from('external_user_access').select('id,email,username,password,status,email_status').eq('id', userId).maybeSingle(),
    client.from('email_templates').select('*').eq('id', WELCOME_TEMPLATE_ID).eq('active', true).maybeSingle(),
  ]);
  if (userResult.error || templateResult.error) {
    return response.status(502).json({ error: userResult.error?.message || templateResult.error?.message });
  }
  if (!userResult.data) return response.status(404).json({ error: 'User registration not found.' });
  if (userResult.data.status !== 'DONE') return response.status(409).json({ error: 'Set the user registration status to DONE before previewing the email.' });
  if (!templateResult.data) return response.status(409).json({ error: 'The CargoMove welcome template is not active.' });

  try {
    const rendered = renderWelcomeTemplate(templateResult.data, userResult.data);
    response.json({
      ...rendered,
      templateName: templateResult.data.name,
      previewToken: createPreviewToken(session, userResult.data, templateResult.data),
    });
  } catch (error) {
    response.status(400).json({ error: error instanceof Error ? error.message : 'Unable to render the email.' });
  }
}
