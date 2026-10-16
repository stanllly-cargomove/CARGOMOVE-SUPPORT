import { adminClient, readSession, requestBody } from '../../api/_runtime.js';
import { allowedOrigin, schedulerAdmin } from './access.js';
import { parseSchedulerUrl, schedulerUrl } from './targets.js';
import type { SavedScheduler } from '../../src/types/scheduler.js';

const FIELDS = 'id,display_name,worker_name,task_id,description,enabled';
function serialize(row: any): SavedScheduler {
  return { id: row.id, displayName: row.display_name, workerName: row.worker_name,
    description: row.description, enabled: row.enabled, url: schedulerUrl({ taskId: row.task_id, workerName: row.worker_name }) };
}

export function createSchedulerCatalog(deps = { adminClient, readSession }) {
  return async function catalog(request: any, response: any) {
    response.setHeader('Cache-Control', 'no-store');
    const fail = (status: number, message: string) => response.status(status).json({ error: message });
    if (!['GET', 'POST'].includes(request.method)) {
      response.setHeader('Allow', 'GET, POST'); return fail(405, 'Method not allowed.');
    }
    const access = await schedulerAdmin(request, deps);
    if ('code' in access) return fail(access.code, access.message);
    if (request.method === 'POST' && (!allowedOrigin(request.headers.origin)
      || request.headers['x-cargomove-confirm'] !== 'manage-schedulers' || request.headers['sec-fetch-site'] === 'cross-site')) {
      return fail(403, 'Request origin or confirmation is invalid.');
    }
    try {
      const { client, session } = access;
      if (request.method === 'GET') {
        const rows = await client.from('cargomove_schedulers').select(FIELDS).order('created_at').limit(200).timeout(8000);
        if (rows.error) return fail(503, 'Unable to load scheduler gallery. Apply the scheduler gallery migration.');
        return response.status(200).json({ schedulers: (rows.data || []).map(serialize) });
      }
      const body = await requestBody(request).catch(() => null) as Record<string, unknown> | null;
      if (!body || Array.isArray(body)) return fail(400, 'Enter scheduler details.');
      const displayName = typeof body.displayName === 'string' ? body.displayName.trim() : '';
      const description = typeof body.description === 'string' ? body.description.trim() : '';
      if (!displayName || displayName.length > 100 || description.length > 500) return fail(400, 'Enter a title up to 100 characters and a description up to 500 characters.');
      let target: ReturnType<typeof parseSchedulerUrl>;
      try { target = parseSchedulerUrl(body.url); } catch (error) { return fail(400, (error as Error).message); }
      const saved = await client.from('cargomove_schedulers').insert({
        display_name: displayName, description, task_id: target.taskId, worker_name: target.workerName, created_by: session.id,
      }).select(FIELDS).timeout(8000).single();
      if (saved.error) return fail(saved.error.code === '23505' ? 409 : 503,
        saved.error.code === '23505' ? 'That scheduler ID or worker name is already saved.' : 'Unable to save the scheduler. Check the scheduler gallery migration.');
      return response.status(201).json({ scheduler: serialize(saved.data) });
    } catch { return fail(503, 'Scheduler gallery is temporarily unavailable.'); }
  };
}

export default createSchedulerCatalog();
