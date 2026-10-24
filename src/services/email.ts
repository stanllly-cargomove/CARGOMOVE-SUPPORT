export interface EmailAttachment {
  path: string;
  name: string;
  content_type: string;
  size: number;
}

export interface EmailTemplate {
  id: string;
  name: string;
  trigger_status: 'DONE' | 'REJECTED';
  rejection_reason?: 'ALREADY_REGISTERED_BOTH' | 'NORTHPORT_ADDED' | 'NO_LEDGER_CODE' | 'OTHER' | null;
  port_id?: string | null;
  port_ids?: string[];
  template_code?: string | null;
  legacy_fallback?: boolean;
  recipient_template: '{{user.email}}';
  subject_template: string;
  body_template: string;
  attachments: EmailAttachment[];
  active: boolean;
  version: number;
  updated_at?: string;
}

export interface EmailTemplatePort { id: string; display_name: string; active: boolean }

export type WelcomeEmailTemplate = EmailTemplate;

export interface EmailPreview {
  recipient: string;
  subject: string;
  body: string;
  templateName: string;
  templateCode?: string | null;
  portId?: string | null;
  previewToken: string;
  attachments: EmailAttachment[];
}

export interface EmailLog {
  id: string;
  recipient: string;
  subject: string;
  template_name: string;
  template_code?: string | null;
  requested_at: string;
  sent_at?: string;
  status: 'SENDING' | 'SENT' | 'FAILED';
}

async function parse<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || 'Email request failed.');
  return body as T;
}

export async function getEmailTemplates(): Promise<EmailTemplate[]> {
  return (await getEmailTemplateCatalog()).templates;
}

export async function getEmailTemplateCatalog(): Promise<{ templates: EmailTemplate[]; ports: EmailTemplatePort[]; apiSupportsPortCodes: boolean }> {
  const response = await fetch('/api/email/templates', { credentials: 'include', cache: 'no-store' });
  const result = await parse<{ templates?: EmailTemplate[]; template?: EmailTemplate | null; ports?: EmailTemplatePort[]; portAssignmentMode?: string }>(response);
  // During a rolling/local update the API may still be serving the previous
  // single-template response shape. Supporting it prevents the page crashing
  // while the API process restarts or frontend/backend deployments overlap.
  const templates = Array.isArray(result.templates)
    ? result.templates
    : result.template
      ? [result.template]
      : [];
  return {
    templates: templates.map((template) => ({ ...template, attachments: Array.isArray(template.attachments) ? template.attachments : [] })),
    ports: Array.isArray(result.ports) ? result.ports : [],
    apiSupportsPortCodes: result.portAssignmentMode === 'shared',
  };
}

export async function saveEmailTemplate(template: Pick<EmailTemplate, 'id' | 'name' | 'trigger_status' | 'rejection_reason' | 'port_id' | 'port_ids' | 'template_code' | 'recipient_template' | 'subject_template' | 'body_template' | 'attachments' | 'active'>, create = false) {
  const response = await fetch('/api/email/templates', {
    method: create ? 'POST' : 'PUT',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(template),
  });
  try {
    return (await parse<{ template: EmailTemplate }>(response)).template;
  } catch (error) {
    if (template.port_ids?.length && error instanceof Error && error.message === 'Select a port for this code.') {
      throw new Error('The API server is still using the old single-port template format. Restart the API server (or redeploy the backend), then reload this page and save again.');
    }
    throw error;
  }
}

export async function deleteEmailTemplate(id: string) {
  const response = await fetch('/api/email/templates', {
    method: 'DELETE', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }),
  });
  return parse<{ activeTemplateId: string }>(response);
}

export async function uploadEmailAttachment(file: File, templateId = 'cargomove-welcome'): Promise<EmailAttachment> {
  const signResponse = await fetch('/api/email/attachments', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: file.name, contentType: file.type, size: file.size, templateId }),
  });
  const signed = await parse<{ signedUrl: string; attachment: EmailAttachment }>(signResponse);
  const form = new FormData();
  form.append('cacheControl', '3600');
  form.append('', file);
  const uploadResponse = await fetch(signed.signedUrl, {
    method: 'PUT',
    headers: { 'x-upsert': 'false' },
    body: form,
  });
  if (!uploadResponse.ok) {
    const result = await uploadResponse.json().catch(() => ({}));
    throw new Error(result.message || result.error || `Unable to upload ${file.name}.`);
  }
  return signed.attachment;
}

export async function getGmailStatus() {
  const response = await fetch('/api/gmail/status', { credentials: 'include', cache: 'no-store' });
  return parse<{ connected: boolean; connection: { email: string; status: string; connected_at: string } | null }>(response);
}

export async function connectGmail() {
  const response = await fetch('/api/gmail/connect', { method: 'POST', credentials: 'include' });
  const result = await parse<{ authorizationUrl: string }>(response);
  window.location.assign(result.authorizationUrl);
}

export async function generateWelcomeEmailPreview(userId: string, templateId?: string, portId?: string) {
  const response = await fetch('/api/email/preview', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId, templateId, portId }),
  });
  const preview = await parse<EmailPreview>(response);
  return { ...preview, attachments: preview.attachments || [] };
}

export async function sendWelcomeEmail(preview: EmailPreview) {
  const response = await fetch('/api/email/send', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(preview),
  });
  return parse<{ status: 'SENT'; sentAt: string; gmailMessageId: string }>(response);
}

export async function generateSubmissionEmailPreview(submissionId: string, status: 'DONE' | 'REJECTED', templateId: string, portId: string) {
  const response = await fetch('/api/email/submission-preview', {
    method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ submissionId, status, templateId, portId }),
  });
  const preview = await parse<EmailPreview>(response);
  return { ...preview, attachments: preview.attachments || [] };
}

export async function sendSubmissionEmail(preview: EmailPreview) {
  const response = await fetch('/api/email/submission-send', {
    method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(preview),
  });
  return parse<{ status: 'SENT'; sentAt: string; gmailMessageId: string; warning?: string }>(response);
}

export async function generateSubmissionBatchEmailPreviews(submissionIds: string[]) {
  const response = await fetch('/api/email/submission-batch-preview', {
    method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ submissionIds }),
  });
  const result = await parse<{ previews: EmailPreview[] }>(response);
  return result.previews.map((preview) => ({ ...preview, attachments: preview.attachments || [] }));
}

export async function sendSubmissionBatchEmail(preview: EmailPreview) {
  const response = await fetch('/api/email/submission-batch-send', {
    method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(preview),
  });
  return parse<{ status: 'SENT'; sentAt: string; gmailMessageId: string; warning?: string }>(response);
}

export async function getEmailLogs(offset = 0, limit = 30, snapshotAt = '') {
  const query = new URLSearchParams({ offset: String(offset), limit: String(limit) });
  if (snapshotAt) query.set('snapshot_at', snapshotAt);
  const response = await fetch(`/api/email/logs?${query}`, { credentials: 'include', cache: 'no-store' });
  const result = await parse<{ logs: EmailLog[]; total?: number }>(response);
  return { logs: result.logs, total: result.total ?? (offset === 0 ? result.logs.length : undefined) };
}
