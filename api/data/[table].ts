import { adminClient, missingVariables, readSession, requestBody } from '../_runtime.js';

const writableTables = new Set(['companies', 'port_configs', 'depot_configs', 'registration_submissions', 'user_registrations', 'haulier_guidelines']);

export default async function upsert(request: any, response: any) {
  const session = readSession(request);
  if (!session || session.type !== 'ADMIN') {
    response.status(401).json({ error: 'Authentication required.' });
    return;
  }
  const table = request.query?.table || request.url.split('/').filter(Boolean).pop();
  if (!writableTables.has(table)) {
    response.status(404).json({ error: 'Unknown table.' });
    return;
  }
  const client = adminClient();
  if (!client) {
    response.status(503).json({ error: 'Supabase server access is not configured.', missing: missingVariables });
    return;
  }
  const row = await requestBody(request);
  const { data, error } = await client.from(table).upsert(row).select().single();
  if (error) {
    response.status(400).json({ error: error.message });
    return;
  }
  response.json(data);
}
