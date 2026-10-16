// Routed through the single Express Vercel function.
import { bodyOf, configuredClient, emailHtmlToText, EmailTemplate, noStore, requireAdmin, sanitizeEmailHtml, validateTemplateAttachments } from '../_email.js';
import { serviceRoleKey, supabaseUrl } from '../../api/_runtime.js';

const fields = 'id,name,trigger_status,rejection_reason,port_id,template_code,recipient_template,subject_template,body_template,attachments,active,version,updated_at';
const TEMPLATE_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,99}$/;
const REQUIRED_REJECTION_TEMPLATE_IDS = new Set([
  'rejection-already-registered-both',
  'rejection-northport-added',
  'rejection-no-ledger-code',
  'rejection-other',
]);

export default async function templates(request: any, response: any) {
  noStore(response);
  const session = requireAdmin(request, response);
  if (!session) return;
  const client = configuredClient(response);
  if (!client) return;

  if (request.method === 'GET') {
    const [{ data, error }, { data: ports, error: portError }] = await Promise.all([
      client.from('email_templates').select(fields).order('active', { ascending: false }).order('updated_at', { ascending: false }),
      client.from('port_configs').select('id,display_name,active').order('display_name'),
    ]);
    if (error || portError) return response.status(502).json({ error: error?.message || portError?.message });
    const templates = (data || []).sort((left: EmailTemplate, right: EmailTemplate) => Number(right.active) - Number(left.active));
    return response.json({ templates, ports: ports || [] });
  }

  if (request.method === 'DELETE') {
    const body: Record<string, unknown> = await bodyOf(request).catch(() => ({}));
    const id = String(body.id || '');
    if (!TEMPLATE_ID_PATTERN.test(id)) return response.status(400).json({ error: 'A valid template ID is required.' });
    if (REQUIRED_REJECTION_TEMPLATE_IDS.has(id)) return response.status(409).json({ error: 'Built-in rejection templates can be edited but cannot be removed.' });
    const { data: all, error: readError } = await client.from('email_templates').select('id,active,attachments,port_id,trigger_status,rejection_reason').order('updated_at', { ascending: false });
    if (readError) return response.status(502).json({ error: readError.message });
    const target = all?.find((item) => item.id === id);
    if (!target) return response.status(404).json({ error: 'Email template not found.' });
    if ((all?.length || 0) <= 1) return response.status(409).json({ error: 'At least one email template is required.' });
    const replacement = !target.port_id && target.active ? all?.find((item) => item.id !== id && !item.port_id && item.trigger_status === target.trigger_status && item.rejection_reason === target.rejection_reason) : undefined;
    if (!target.port_id && target.active && !replacement) return response.status(409).json({ error: 'Activate another default template for this outcome before removing this one.' });
    const { error: deleteError } = await client.from('email_templates').delete().eq('id', id);
    if (deleteError) return response.status(409).json({ error: deleteError.message });
    if (replacement) {
      const { error: activateError } = await client.from('email_templates').update({ active: true, updated_by: session.id }).eq('id', replacement.id);
      if (activateError) return response.status(502).json({ error: `Template removed, but another template could not be activated: ${activateError.message}` });
    }
    const paths = validateTemplateAttachments(target.attachments || []).map((attachment) => attachment.path);
    if (paths.length && supabaseUrl && serviceRoleKey) {
      await Promise.all(paths.map((path) => fetch(`${supabaseUrl}/storage/v1/object/email-attachments/${path.split('/').map(encodeURIComponent).join('/')}`, {
        method: 'DELETE', headers: { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}` },
      }).catch(() => undefined)));
    }
    return response.json({ activeTemplateId: replacement?.id || all?.find((item) => item.active && item.id !== id)?.id || '' });
  }

  if (request.method === 'POST' || request.method === 'PUT') {
    const body: Record<string, unknown> = await bodyOf(request).catch(() => ({}));
    const id = String(body.id || '').trim();
    const name = String(body.name || '').trim();
    const subjectTemplate = String(body.subject_template || '').trim();
    const bodyTemplate = sanitizeEmailHtml(String(body.body_template || ''));
    const recipientTemplate = String(body.recipient_template || '').trim();
    const triggerStatus = body.trigger_status === 'REJECTED' ? 'REJECTED' : 'DONE';
    const portId = String(body.port_id || '').trim() || null;
    const templateCode = String(body.template_code || '').trim().toUpperCase() || null;
    const rejectionReason = (triggerStatus === 'REJECTED' && !portId ? String(body.rejection_reason || '') : null) as EmailTemplate['rejection_reason'];
    if (!TEMPLATE_ID_PATTERN.test(id)) return response.status(400).json({ error: 'A valid template ID is required.' });
    if (!name || !subjectTemplate || !emailHtmlToText(bodyTemplate) || recipientTemplate !== '{{user.email}}') {
      return response.status(400).json({ error: 'Name, subject, body, and the {{user.email}} recipient are required.' });
    }
    if (portId && (!templateCode || !/^[A-Z0-9][A-Z0-9_-]{0,31}$/.test(templateCode))) return response.status(400).json({ error: 'Use a code of up to 32 letters, numbers, underscores, or hyphens.' });
    if (!portId && templateCode) return response.status(400).json({ error: 'Select a port for this code.' });
    if (portId) {
      const { data: port, error: portError } = await client.from('port_configs').select('id').eq('id', portId).maybeSingle();
      if (portError) return response.status(502).json({ error: portError.message });
      if (!port) return response.status(400).json({ error: 'The selected port does not exist.' });
    }
    if (triggerStatus === 'REJECTED' && !portId && !['ALREADY_REGISTERED_BOTH', 'NORTHPORT_ADDED', 'NO_LEDGER_CODE', 'OTHER'].includes(rejectionReason || '')) {
      return response.status(400).json({ error: 'A valid rejection reason is required for a rejection template.' });
    }
    if (name.length > 120 || subjectTemplate.length > 998 || bodyTemplate.length > 100_000) return response.status(400).json({ error: 'The email template is too large.' });
    const combined = `${recipientTemplate}\n${subjectTemplate}\n${bodyTemplate}`;
    const variables = [...combined.matchAll(/{{\s*([^}]+)\s*}}/g)].map((match) => match[1].trim());
    const allowed = new Set(['user.email', 'user.username', 'user.password', 'rejection.reason']);
    if (variables.some((variable) => !allowed.has(variable))) return response.status(400).json({ error: 'The template contains an unsupported variable.' });
    if (variables.includes('rejection.reason') && (triggerStatus !== 'REJECTED' || (!portId && rejectionReason !== 'OTHER'))) return response.status(400).json({ error: '{{rejection.reason}} requires a port rejection code or the Other rejection reason.' });
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
    if (current && (current.port_id !== portId || current.template_code !== templateCode || current.trigger_status !== triggerStatus || current.rejection_reason !== rejectionReason)) return response.status(409).json({ error: 'Port, code, and outcome cannot be changed after a template is created.' });
    const active = body.active === true;
    if (current?.active && !active && !portId) {
      let otherQuery = client.from('email_templates').select('id').eq('active', true).is('port_id', null).eq('trigger_status', triggerStatus).neq('id', id);
      if (rejectionReason) otherQuery = otherQuery.eq('rejection_reason', rejectionReason);
      const { data: otherActive } = await otherQuery;
      if (!otherActive?.length) return response.status(409).json({ error: 'Activate another template before making this template inactive.' });
    }
    const template: EmailTemplate = {
      id, name, trigger_status: triggerStatus, rejection_reason: rejectionReason, port_id: portId, template_code: templateCode, recipient_template: recipientTemplate, subject_template: subjectTemplate,
      body_template: bodyTemplate, attachments, active: portId ? active : current?.active === true, version: Number(current?.version || 0) + 1,
    };
    const { error } = await client.from('email_templates').upsert({
      ...template, updated_by: session.id, created_by: current ? undefined : session.id,
    });
    if (error) return response.status(400).json({ error: error.message });
    if (active && !portId) {
      let deactivateQuery = client.from('email_templates').update({ active: false, updated_by: session.id }).neq('id', id).eq('active', true).is('port_id', null).eq('trigger_status', triggerStatus);
      if (rejectionReason) deactivateQuery = deactivateQuery.eq('rejection_reason', rejectionReason);
      const { error: deactivateError } = await deactivateQuery;
      if (deactivateError) return response.status(502).json({ error: deactivateError.message });
      const { error: activateError } = await client.from('email_templates').update({ active: true, updated_by: session.id }).eq('id', id);
      if (activateError) return response.status(502).json({ error: activateError.message });
    }
    const { data, error: resultError } = await client.from('email_templates').select(fields).eq('id', id).single();
    if (resultError) return response.status(502).json({ error: resultError.message });
    return response.json({ template: data });
  }

  response.status(405).json({ error: 'Method not allowed.' });
}
