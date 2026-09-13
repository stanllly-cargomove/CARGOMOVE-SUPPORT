// Routed through the single Express Vercel function.
import { bodyOf, configuredClient, EmailTemplate, noStore, requireAdmin, validateTemplateAttachments, WELCOME_TEMPLATE_ID } from '../_email.js';

const fields = 'id,name,trigger_status,recipient_template,subject_template,body_template,attachments,active,version,updated_at';

export default async function templates(request: any, response: any) {
  noStore(response);
  const session = requireAdmin(request, response);
  if (!session) return;
  const client = configuredClient(response);
  if (!client) return;

  if (request.method === 'GET') {
    const { data, error } = await client.from('email_templates').select(fields).eq('id', WELCOME_TEMPLATE_ID).maybeSingle();
    if (error) return response.status(502).json({ error: error.message });
    return response.json({ template: data });
  }

  if (request.method === 'PUT') {
    const body: Record<string, unknown> = await bodyOf(request).catch(() => ({}));
    const name = String(body.name || '').trim();
    const subjectTemplate = String(body.subject_template || '').trim();
    const bodyTemplate = String(body.body_template || '').trim();
    const recipientTemplate = String(body.recipient_template || '').trim();
    if (!name || !subjectTemplate || !bodyTemplate || recipientTemplate !== '{{user.email}}') {
      return response.status(400).json({ error: 'Name, subject, body, and the {{user.email}} recipient are required.' });
    }
    if (subjectTemplate.length > 998 || bodyTemplate.length > 100_000) {
      return response.status(400).json({ error: 'The email template is too large.' });
    }
    const combined = `${recipientTemplate}\n${subjectTemplate}\n${bodyTemplate}`;
    const variables = [...combined.matchAll(/{{\s*([^}]+)\s*}}/g)].map((match) => match[1].trim());
    const allowed = new Set(['user.email', 'user.username', 'user.password']);
    if (variables.some((variable) => !allowed.has(variable))) {
      return response.status(400).json({ error: 'Only {{user.email}}, {{user.username}}, and {{user.password}} are supported.' });
    }
    let attachments;
    try {
      attachments = validateTemplateAttachments(body.attachments ?? []);
    } catch (error) {
      return response.status(400).json({ error: error instanceof Error ? error.message : 'Invalid attachments.' });
    }
    const { data: current, error: readError } = await client
      .from('email_templates').select(fields).eq('id', WELCOME_TEMPLATE_ID).maybeSingle();
    if (readError) return response.status(502).json({ error: readError.message });
    const template: EmailTemplate = {
      id: WELCOME_TEMPLATE_ID,
      name,
      trigger_status: 'DONE',
      recipient_template: recipientTemplate,
      subject_template: subjectTemplate,
      body_template: bodyTemplate,
      attachments,
      active: body.active !== false,
      version: Number(current?.version || 0) + 1,
    };
    const { data, error } = await client.from('email_templates').upsert({
      ...template,
      updated_by: session.id,
      created_by: current ? undefined : session.id,
    }).select(fields).single();
    if (error) return response.status(400).json({ error: error.message });
    return response.json({ template: data });
  }

  response.status(405).json({ error: 'Method not allowed.' });
}
