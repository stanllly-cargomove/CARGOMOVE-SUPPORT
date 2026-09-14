// Routed through the single Express Vercel function.
import { bodyOf, configuredClient, emailHtmlToText, EmailTemplate, noStore, requireAdmin, sanitizeEmailHtml, validateTemplateAttachments } from '../_email.js';
import { serviceRoleKey, supabaseUrl } from '../../api/_runtime.js';

const fields = 'id,name,trigger_status,rejection_reason,recipient_template,subject_template,body_template,attachments,active,version,updated_at';
const TEMPLATE_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,99}$/;
const REQUIRED_REJECTION_TEMPLATE_IDS = new Set([
  'rejection-already-registered-both',
  'rejection-northport-added',
  'rejection-other',
]);

export default async function templates(request: any, response: any) {
  noStore(response);
  const session = requireAdmin(request, response);
  if (!session) return;
  const client = configuredClient(response);
  if (!client) return;

  if (request.method === 'GET') {
    const { data, error } = await client.from('email_templates').select(fields).order('active', { ascending: false }).order('updated_at', { ascending: false });
    if (error) return response.status(502).json({ error: error.message });
    const templates = (data || []).sort((left: EmailTemplate, right: EmailTemplate) => Number(right.active) - Number(left.active));
    return response.json({ templates });
  }

  if (request.method === 'DELETE') {
    const body: Record<string, unknown> = await bodyOf(request).catch(() => ({}));
    const id = String(body.id || '');
    if (!TEMPLATE_ID_PATTERN.test(id)) return response.status(400).json({ error: 'A valid template ID is required.' });
    if (REQUIRED_REJECTION_TEMPLATE_IDS.has(id)) return response.status(409).json({ error: 'Built-in rejection templates can be edited but cannot be removed.' });
    const { data: all, error: readError } = await client.from('email_templates').select('id,active,attachments').order('updated_at', { ascending: false });
    if (readError) return response.status(502).json({ error: readError.message });
    const target = all?.find((item) => item.id === id);
    if (!target) return response.status(404).json({ error: 'Email template not found.' });
    if ((all?.length || 0) <= 1) return response.status(409).json({ error: 'At least one email template is required.' });
    const replacement = all?.find((item) => item.id !== id);
    const { error: deleteError } = await client.from('email_templates').delete().eq('id', id);
    if (deleteError) return response.status(409).json({ error: deleteError.message });
    if (target.active && replacement) {
      const { error: activateError } = await client.from('email_templates').update({ active: true, updated_by: session.id }).eq('id', replacement.id);
      if (activateError) return response.status(502).json({ error: `Template removed, but another template could not be activated: ${activateError.message}` });
    }
    const paths = validateTemplateAttachments(target.attachments || []).map((attachment) => attachment.path);
    if (paths.length && supabaseUrl && serviceRoleKey) {
      await Promise.all(paths.map((path) => fetch(`${supabaseUrl}/storage/v1/object/email-attachments/${path.split('/').map(encodeURIComponent).join('/')}`, {
        method: 'DELETE', headers: { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}` },
      }).catch(() => undefined)));
    }
    return response.json({ activeTemplateId: target.active ? replacement?.id : all?.find((item) => item.active)?.id });
  }

  if (request.method === 'POST' || request.method === 'PUT') {
    const body: Record<string, unknown> = await bodyOf(request).catch(() => ({}));
    const id = String(body.id || '').trim();
    const name = String(body.name || '').trim();
    const subjectTemplate = String(body.subject_template || '').trim();
    const bodyTemplate = sanitizeEmailHtml(String(body.body_template || ''));
    const recipientTemplate = String(body.recipient_template || '').trim();
    const triggerStatus = body.trigger_status === 'REJECTED' ? 'REJECTED' : 'DONE';
    const rejectionReason = (triggerStatus === 'REJECTED' ? String(body.rejection_reason || '') : null) as EmailTemplate['rejection_reason'];
    if (!TEMPLATE_ID_PATTERN.test(id)) return response.status(400).json({ error: 'A valid template ID is required.' });
    if (!name || !subjectTemplate || !emailHtmlToText(bodyTemplate) || recipientTemplate !== '{{user.email}}') {
      return response.status(400).json({ error: 'Name, subject, body, and the {{user.email}} recipient are required.' });
    }
    if (triggerStatus === 'REJECTED' && !['ALREADY_REGISTERED_BOTH', 'NORTHPORT_ADDED', 'OTHER'].includes(rejectionReason || '')) {
      return response.status(400).json({ error: 'A valid rejection reason is required for a rejection template.' });
    }
    if (name.length > 120 || subjectTemplate.length > 998 || bodyTemplate.length > 100_000) return response.status(400).json({ error: 'The email template is too large.' });
    const combined = `${recipientTemplate}\n${subjectTemplate}\n${bodyTemplate}`;
    const variables = [...combined.matchAll(/{{\s*([^}]+)\s*}}/g)].map((match) => match[1].trim());
    const allowed = new Set(['user.email', 'user.username', 'user.password', 'rejection.reason']);
    if (variables.some((variable) => !allowed.has(variable))) return response.status(400).json({ error: 'The template contains an unsupported variable.' });
    if (variables.includes('rejection.reason') && rejectionReason !== 'OTHER') return response.status(400).json({ error: '{{rejection.reason}} is only available for the Other rejection template.' });
    let attachments;
    try {
      attachments = validateTemplateAttachments(body.attachments ?? []);
      if (attachments.some((attachment) => !attachment.path.startsWith(`${id}/`))) throw new Error('An attachment belongs to a different template.');
    } catch (error) {
      return response.status(400).json({ error: error instanceof Error ? error.message : 'Invalid attachments.' });
    }
    const { data: current, error: readError } = await client.from('email_templates').select(fields).eq('id', id).maybeSingle();
    if (readError) return response.status(502).json({ error: readError.message });
    if (request.method === 'POST' && current) return response.status(409).json({ error: 'This template already exists.' });
    if (request.method === 'PUT' && !current) return response.status(404).json({ error: 'Email template not found.' });
    const active = body.active === true;
    if (current?.active && !active) {
      const { data: otherActive } = await client.from('email_templates').select('id').eq('active', true).neq('id', id);
      if (!otherActive?.length) return response.status(409).json({ error: 'Activate another template before making this template inactive.' });
    }
    const template: EmailTemplate = {
      id, name, trigger_status: triggerStatus, rejection_reason: rejectionReason, recipient_template: recipientTemplate, subject_template: subjectTemplate,
      body_template: bodyTemplate, attachments, active: current?.active === true, version: Number(current?.version || 0) + 1,
    };
    const { error } = await client.from('email_templates').upsert({
      ...template, updated_by: session.id, created_by: current ? undefined : session.id,
    });
    if (error) return response.status(400).json({ error: error.message });
    if (active) {
      const { error: activateError } = await client.from('email_templates').update({ active: true, updated_by: session.id }).eq('id', id);
      if (activateError) return response.status(502).json({ error: activateError.message });
      let deactivateQuery = client.from('email_templates').update({ active: false, updated_by: session.id }).neq('id', id).eq('active', true).eq('trigger_status', triggerStatus);
      if (rejectionReason) deactivateQuery = deactivateQuery.eq('rejection_reason', rejectionReason);
      const { error: deactivateError } = await deactivateQuery;
      if (deactivateError) return response.status(502).json({ error: deactivateError.message });
    }
    const { data, error: resultError } = await client.from('email_templates').select(fields).eq('id', id).single();
    if (resultError) return response.status(502).json({ error: resultError.message });
    return response.json({ template: data });
  }

  response.status(405).json({ error: 'Method not allowed.' });
}
