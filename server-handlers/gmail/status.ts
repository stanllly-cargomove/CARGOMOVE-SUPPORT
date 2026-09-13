// Routed through the single Express Vercel function.
import { configuredClient, noStore, requireAdmin } from '../_email.js';

export default async function gmailStatus(request: any, response: any) {
  noStore(response);
  if (request.method !== 'GET') return response.status(405).json({ error: 'Method not allowed.' });
  if (!requireAdmin(request, response)) return;
  const client = configuredClient(response);
  if (!client) return;
  const { data, error } = await client
    .from('gmail_connections')
    .select('email,status,connected_at,updated_at,last_error_code')
    .eq('id', 'system')
    .maybeSingle();
  if (error) return response.status(502).json({ error: error.message });
  response.json({ connected: data?.status === 'ACTIVE', connection: data || null });
}
