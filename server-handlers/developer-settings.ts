import { adminClient, readSession, requestBody } from '../api/_runtime.js';
import { allowedOrigin, schedulerAdmin } from './scheduler/access.js';

const fields = 'registration_test_tools_enabled,simulation_enabled';
const serialize = (row: any) => ({ registrationTestToolsEnabled: row?.registration_test_tools_enabled === true, simulationEnabled: row?.simulation_enabled === true });

export function createDeveloperSettingsHandler(deps = { adminClient, readSession }) {
  return async function developerSettings(request: any, response: any) {
    response.setHeader('Cache-Control', 'no-store, max-age=0');
    if (!['GET', 'PATCH'].includes(request.method)) return response.status(405).json({ error: 'Method not allowed.' });
    try {
      if (request.method === 'GET') {
        const client = deps.adminClient();
        if (!client) return response.status(503).json({ error: 'Developer settings are unavailable.' });
        const result = await client.from('developer_settings').select(fields).eq('id', 'system').timeout(8000).maybeSingle();
        if (result.error || !result.data) return response.status(503).json({ error: 'Developer settings are unavailable. Apply the shared developer settings migration.' });
        return response.json({ settings: serialize(result.data) });
      }
      const access = await schedulerAdmin(request, deps);
      if ('code' in access) return response.status(access.code).json({ error: access.message });
      if (!allowedOrigin(request.headers.origin) || request.headers['sec-fetch-site'] === 'cross-site' || request.headers['x-cargomove-confirm'] !== 'manage-developer-settings') return response.status(403).json({ error: 'Request origin or confirmation is invalid.' });
      const body = await requestBody(request).catch(() => null) as Record<string, unknown> | null;
      const keys = body && !Array.isArray(body) ? Object.keys(body) : [];
      if (!keys.length || keys.some(key => !['registrationTestToolsEnabled', 'simulationEnabled'].includes(key) || typeof body![key] !== 'boolean')) return response.status(400).json({ error: 'Choose valid developer settings.' });
      const change: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (typeof body!.registrationTestToolsEnabled === 'boolean') change.registration_test_tools_enabled = body!.registrationTestToolsEnabled;
      if (typeof body!.simulationEnabled === 'boolean') change.simulation_enabled = body!.simulationEnabled;
      const result = await access.client.from('developer_settings').update(change).eq('id', 'system').select(fields).timeout(8000).maybeSingle();
      if (result.error || !result.data) return response.status(503).json({ error: 'Unable to save developer settings. Apply the shared developer settings migration.' });
      return response.json({ settings: serialize(result.data) });
    } catch { return response.status(503).json({ error: 'Developer settings are temporarily unavailable.' }); }
  };
}
export default createDeveloperSettingsHandler();
