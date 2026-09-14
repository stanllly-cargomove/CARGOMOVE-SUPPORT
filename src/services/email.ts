export interface EmailAttachment {
  path: string;
  name: string;
  content_type: string;
  size: number;
}

export interface EmailTemplate {
  id: string;
  name: string;
  trigger_status: 'DONE';
  recipient_template: '{{user.email}}';
  subject_template: string;
  body_template: string;
  attachments: EmailAttachment[];
  active: boolean;
  version: number;
  updated_at?: string;
}

export type WelcomeEmailTemplate = EmailTemplate;

export interface EmailPreview {
  recipient: string;
  subject: string;
  body: string;
  templateName: string;
  previewToken: string;
  attachments: EmailAttachment[];
}

export interface EmailLog {
  id: string;
  recipient: string;
  subject: string;
  template_name: string;
  external_user_id: string;
  sent_by_email: string;
  requested_at: string;
  sent_at?: string;
  status: 'SENDING' | 'SENT' | 'FAILED';
  gmail_message_id?: string;
  error_code?: string;
  attachments?: EmailAttachment[];
}

async function parse<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || 'Email request failed.');
  return body as T;
}

export async function getEmailTemplates(): Promise<EmailTemplate[]> {
  const response = await fetch('/api/email/templates', { credentials: 'include', cache: 'no-store' });
  const result = await parse<{ templates?: EmailTemplate[]; template?: EmailTemplate | null }>(response);
  // During a rolling/local update the API may still be serving the previous
  // single-template response shape. Supporting it prevents the page crashing
  // while the API process restarts or frontend/backend deployments overlap.
  const templates = Array.isArray(result.templates)
    ? result.templates
    : result.template
      ? [result.template]
      : [];
  return templates.map((template) => ({ ...template, attachments: Array.isArray(template.attachments) ? template.attachments : [] }));
}

export async function saveEmailTemplate(template: Pick<EmailTemplate, 'id' | 'name' | 'recipient_template' | 'subject_template' | 'body_template' | 'attachments' | 'active'>, create = false) {
  const response = await fetch('/api/email/templates', {
    method: create ? 'POST' : 'PUT',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(template),
  });
  return (await parse<{ template: EmailTemplate }>(response)).template;
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

export async function generateWelcomeEmailPreview(userId: string) {
  const response = await fetch('/api/email/preview', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId }),
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

export async function getEmailLogs() {
  const response = await fetch('/api/email/logs', { credentials: 'include', cache: 'no-store' });
  return (await parse<{ logs: EmailLog[] }>(response)).logs;
}
