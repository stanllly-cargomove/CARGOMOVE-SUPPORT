import { adminClient } from '../../api/_runtime.js';

// Only public facility configuration is exposed. Customer and submission data
// continue to use the authenticated APIs or the reference-number lookup.
export default async function registrationConfig(request: any, response: any) {
  response.setHeader('Cache-Control', 'no-store, max-age=0');
  if (request.method !== 'GET') {
    response.status(405).json({ error: 'Method not allowed.' });
    return;
  }
  const client = adminClient();
  if (!client) {
    response.status(503).json({ error: 'Registration configuration is unavailable.' });
    return;
  }
  const [ports, depots] = await Promise.all([
    client.from('port_configs').select('id,location,display_name,code,backend_port_id,active,description').eq('active', true),
    client.from('depot_configs').select('id,port_id,display_name,backend_depot_id,active').eq('active', true),
  ]);
  if (ports.error || depots.error) {
    response.status(502).json({ error: 'Unable to load registration facilities. Please try again.' });
    return;
  }
  response.json({ ports: ports.data || [], depots: depots.data || [] });
}
