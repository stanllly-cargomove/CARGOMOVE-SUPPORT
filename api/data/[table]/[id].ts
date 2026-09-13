import { adminClient, missingVariables, readSession } from '../../_runtime';

const writableTables = new Set(['companies', 'port_configs', 'depot_configs', 'registration_submissions', 'user_registrations', 'haulier_guidelines']);

export default async function remove(request: any, response: any) {
  const session = readSession(request);
  if (!session || session.type !== 'ADMIN') {
    response.status(401).json({ error: 'Authentication required.' });
    return;
  }
  const parts = request.url.split('/').filter(Boolean);
  const table = request.query?.table || parts[parts.length - 2];
  const id = request.query?.id || parts[parts.length - 1];
  if (!writableTables.has(table)) {
    response.status(404).json({ error: 'Unknown table.' });
    return;
  }
  const client = adminClient();
  if (!client) {
    response.status(503).json({ error: 'Supabase server access is not configured.', missing: missingVariables });
    return;
  }
  const { error } = await client.from(table).delete().eq('id', id);
  if (error) {
    response.status(400).json({ error: error.message });
    return;
  }
  response.status(204).end();
}
