// Routed through the single Express Vercel function.
import { bodyOf, configuredClient, createPreviewToken, noStore, renderWelcomeTemplate, requireAdmin } from '../_email.js';
import { isEmailTemplateForRegistration } from '../../src/utils/registrationEmailTemplates.js';

export default async function preview(request: any, response: any) {
  noStore(response);
  if (request.method !== 'POST') return response.status(405).json({ error: 'Method not allowed.' });
  const session = requireAdmin(request, response);
  if (!session) return;
  const client = configuredClient(response);
  if (!client) return;
  const body: Record<string, unknown> = await bodyOf(request).catch(() => ({}));
  const userId = String(body.userId || '').trim();
  const templateId = String(body.templateId || '').trim();
  const portId = String(body.portId || '').trim();
  if (!userId) return response.status(400).json({ error: 'A user ID is required.' });

  const userResult = await client.from('external_user_access').select('id,email,username,password,company_id,status,rejection_reason,rejection_detail,email_status').eq('id', userId).maybeSingle();
  if (userResult.error) return response.status(502).json({ error: userResult.error.message });
  if (!userResult.data) return response.status(404).json({ error: 'User registration not found.' });
  if (!['DONE', 'REJECTED'].includes(userResult.data.status)) return response.status(409).json({ error: 'Set the user registration status to DONE or REJECTED before previewing the email.' });
  if (userResult.data.status === 'DONE' || (userResult.data.status === 'REJECTED' && templateId)) {
    if (!userResult.data.company_id) return response.status(409).json({ error: 'This user has no linked Company Registration.' });
    let companyQuery = client.from('registration_submissions').select('port_id')
      .eq('company_id', userResult.data.company_id).eq('registration_type', 'COMPANY');
    if (userResult.data.status === 'DONE') companyQuery = companyQuery.eq('status', 'DONE');
    const companyResult = await companyQuery;
    if (companyResult.error) return response.status(502).json({ error: companyResult.error.message });
    if (!companyResult.data?.length) return response.status(409).json({ error: userResult.data.status === 'DONE' ? 'Register the linked company before previewing the acceptance email.' : 'This user has no linked Company Registration port for a rejection code.' });
    const companyPortIds = companyResult.data.map((submission: { port_id: string }) => ['jh-pg-ics', 'jh-pg-depot'].includes(submission.port_id) ? 'johor-port' : submission.port_id);
    if ((userResult.data.status === 'DONE' && !templateId) || !portId || !companyPortIds.includes(portId)) return response.status(409).json({ error: userResult.data.status === 'DONE' ? 'Select an acceptance code assigned to a registered company port.' : 'Select a rejection code assigned to the linked company port.' });
  }
  let templateQuery = client.from('email_templates').select('*').eq('active', true).eq('trigger_status', userResult.data.status);
  if (templateId) {
    if (!portId) return response.status(400).json({ error: 'Select a port for this code.' });
    templateQuery = templateQuery.eq('id', templateId).not('template_code', 'is', null);
  } else {
    templateQuery = templateQuery.eq('legacy_fallback', true);
    if (userResult.data.status === 'REJECTED') {
      if (!userResult.data.rejection_reason) return response.status(409).json({ error: 'Select a rejection reason before previewing the email.' });
      templateQuery = templateQuery.eq('rejection_reason', userResult.data.rejection_reason);
    }
  }
  const templateResult = await templateQuery.order('updated_at', { ascending: false }).limit(1).maybeSingle();
  if (templateResult.error) return response.status(502).json({ error: templateResult.error.message });
  if (!templateResult.data) return response.status(409).json({ error: `No active ${userResult.data.status.toLowerCase()} email template is configured for this selection.` });
  if (!isEmailTemplateForRegistration(templateResult.data, 'COMPANY')) return response.status(409).json({ error: 'Select a company acceptance or rejection code for User Registration.' });
  if (userResult.data.status === 'REJECTED' && templateResult.data.rejection_reason && templateResult.data.rejection_reason !== userResult.data.rejection_reason) {
    return response.status(409).json({ error: 'This rejection code does not match the selected rejection reason.' });
  }
  if (templateId) {
    const { data: assigned, error: assignmentError } = await client.from('email_template_ports').select('port_id').eq('template_id', templateId).eq('port_id', portId).maybeSingle();
    if (assignmentError) return response.status(502).json({ error: assignmentError.message });
    if (!assigned) return response.status(409).json({ error: 'This code is not assigned to the selected port.' });
  }

  try {
    const rendered = renderWelcomeTemplate(templateResult.data, userResult.data);
    response.json({
      ...rendered,
      attachments: templateResult.data.attachments || [],
      templateName: templateResult.data.name,
      templateCode: templateResult.data.template_code,
      portId: portId || null,
      previewToken: createPreviewToken(session, userResult.data, templateResult.data, portId),
    });
  } catch (error) {
    response.status(400).json({ error: error instanceof Error ? error.message : 'Unable to render the email.' });
  }
}
