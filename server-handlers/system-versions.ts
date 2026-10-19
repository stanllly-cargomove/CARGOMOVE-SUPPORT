import { adminClient, readSession } from '../api/_runtime.js';
import { allowedOrigin, schedulerAdmin } from './scheduler/access.js';
import manifest from '../src/generated/system-versions.json';

export function createSystemVersionHandler(deps = { adminClient, readSession }) {
  return async function systemVersions(request: any, response: any) {
    response.setHeader('Cache-Control', 'no-store');
    const fail = (status: number, error: string) => response.status(status).json({ error });
    if (request.method !== 'POST') {
      response.setHeader('Allow', 'POST');
      return fail(405, 'Method not allowed.');
    }
    const access = await schedulerAdmin(request, deps);
    if ('code' in access) return fail(access.code, access.message);
    if (!allowedOrigin(request.headers.origin) || request.headers['sec-fetch-site'] === 'cross-site'
      || request.headers['x-cargomove-confirm'] !== 'record-system-versions') {
      return fail(403, 'Request origin or confirmation is invalid.');
    }
    try {
      // Use only the deployed manifest; browser-supplied history is never trusted.
      // Existing releases remain immutable, including when an older deployment opens.
      const saved = await access.client.from('system_version_history').upsert(manifest.history.map(release => ({
        version: release.version, previous_version: release.previousVersion, changed_at: release.date,
        summary: release.summary, changes: release.changes, files: release.files,
      })), { onConflict: 'version', ignoreDuplicates: true }).timeout(8000);
      if (saved.error) return fail(503, 'Version history could not be saved. Check that the system version database migration has been applied.');
      const history: typeof manifest.history = [];
      // Read in batches to retain history beyond Supabase's default row limit.
      for (let start = 0; ; start += 500) {
        const rows = await access.client.from('system_version_history').select('*')
          .order('changed_at', { ascending: false }).order('version').range(start, start + 499).timeout(8000);
        if (rows.error) return fail(503, 'Saved version history could not be loaded. Please try again.');
        history.push(...(rows.data || []).map(row => ({ version: row.version, previousVersion: row.previous_version,
          date: row.changed_at, summary: row.summary, changes: row.changes, files: row.files })));
        if ((rows.data || []).length < 500) break;
      }
      return response.status(200).json({ history });
    } catch { return fail(503, 'Version history is temporarily unavailable. Please try again.'); }
  };
}

export default createSystemVersionHandler();
