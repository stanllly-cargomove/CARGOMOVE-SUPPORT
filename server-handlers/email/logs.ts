// Routed through the single Express Vercel function.
import { configuredClient, noStore, requireAdmin } from '../_email.js';

export default async function emailLogs(request: any, response: any) {
  noStore(response);
  if (request.method !== 'GET') return response.status(405).json({ error: 'Method not allowed.' });
  if (!requireAdmin(request, response)) return;
  const client = configuredClient(response);
  if (!client) return;
  const offset = Number(request.query?.offset ?? 0);
  const requestedLimit = Number(request.query?.limit ?? 30);
  const snapshotAt = typeof request.query?.snapshot_at === 'string' ? request.query.snapshot_at : '';
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isInteger(requestedLimit) || requestedLimit < 1) {
    return response.status(400).json({ error: 'Invalid email log range.' });
  }
  if (snapshotAt && Number.isNaN(Date.parse(snapshotAt))) return response.status(400).json({ error: 'Invalid email log snapshot.' });
  const limit = Math.min(requestedLimit, 30);
  let query = client
    .from('email_logs')
    .select('id,recipient,subject,template_name,template_code,requested_at,sent_at,status', offset === 0 ? { count: 'exact' } : undefined)
    .order('requested_at', { ascending: false });
  if (snapshotAt) query = query.lte('requested_at', snapshotAt);
  const { data, count, error } = await query.range(offset, offset + limit - 1);
  if (error) return response.status(502).json({ error: error.message });
  response.json({ logs: data || [], ...(offset === 0 ? { total: count ?? data?.length ?? 0 } : {}) });
}
