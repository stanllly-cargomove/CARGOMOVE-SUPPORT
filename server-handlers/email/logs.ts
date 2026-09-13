// Routed through the single Express Vercel function.
import { configuredClient, noStore, requireAdmin } from '../_email.js';

export default async function emailLogs(request: any, response: any) {
  noStore(response);
  if (request.method !== 'GET') return response.status(405).json({ error: 'Method not allowed.' });
  if (!requireAdmin(request, response)) return;
  const client = configuredClient(response);
  if (!client) return;
  const { data, error } = await client
    .from('email_logs')
    .select('id,recipient,subject,template_name,external_user_id,sent_by_email,requested_at,sent_at,status,gmail_message_id,error_code,attachments')
    .order('requested_at', { ascending: false })
    .limit(100);
  if (error) return response.status(502).json({ error: error.message });
  response.json({ logs: data || [] });
}
