export interface WelcomeEmailTemplate {
  id: string;
  name: string;
  trigger_status: 'DONE';
  recipient_template: '{{user.email}}';
  subject_template: string;
  body_template: string;
  active: boolean;
  version: number;
  updated_at?: string;
}

export interface EmailPreview {
  recipient: string;
  subject: string;
  body: string;
  templateName: string;
  previewToken: string;
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
}

async function parse<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || 'Email request failed.');
  return body as T;
}

export async function getWelcomeEmailTemplate(): Promise<WelcomeEmailTemplate | null> {
  const response = await fetch('/api/email/templates', { credentials: 'include', cache: 'no-store' });
  return (await parse<{ template: WelcomeEmailTemplate | null }>(response)).template;
}

export async function saveWelcomeEmailTemplate(template: Pick<WelcomeEmailTemplate, 'name' | 'recipient_template' | 'subject_template' | 'body_template' | 'active'>) {
  const response = await fetch('/api/email/templates', {
    method: 'PUT',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(template),
  });
  return (await parse<{ template: WelcomeEmailTemplate }>(response)).template;
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
  return parse<EmailPreview>(response);
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
