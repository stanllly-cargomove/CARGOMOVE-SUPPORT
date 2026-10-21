import { adminClient, readSession, requestBody } from '../../api/_runtime.js';
import { allowedOrigin, schedulerAdmin } from './access.js';
import { parseSchedulerUrl, schedulerUrl } from './targets.js';
import type { SavedScheduler } from '../../src/types/scheduler.js';

const FIELDS = 'id,display_name,worker_name,task_id,description,origin,enabled';
function serialize(row: any): SavedScheduler {
  return { id: row.id, displayName: row.display_name, workerName: row.worker_name,
    description: row.description, origin: row.origin || 'CargoMove', enabled: row.enabled,
    lastRun: row.lastRun || null, url: schedulerUrl({ taskId: row.task_id, workerName: row.worker_name }) };
}

export function createSchedulerCatalog(deps = { adminClient, readSession }) {
  return async function catalog(request: any, response: any) {
    response.setHeader('Cache-Control', 'no-store');
    const fail = (status: number, message: string) => response.status(status).json({ error: message });
    if (!['GET', 'POST', 'PATCH'].includes(request.method)) {
      response.setHeader('Allow', 'GET, POST, PATCH'); return fail(405, 'Method not allowed.');
    }
    const access = await schedulerAdmin(request, deps);
    if ('code' in access) return fail(access.code, access.message);
    if (request.method !== 'GET' && (!allowedOrigin(request.headers.origin)
      || request.headers['x-cargomove-confirm'] !== 'manage-schedulers' || request.headers['sec-fetch-site'] === 'cross-site')) {
      return fail(403, 'Request origin or confirmation is invalid.');
    }
    try {
      const { client, session } = access;
      if (request.method === 'GET') {
        const rows = await client.from('cargomove_schedulers').select(FIELDS).order('display_name').limit(200).timeout(8000);
        if (rows.error) return fail(503, 'Unable to load scheduler gallery. Apply the scheduler gallery migration.');
        const schedulerRows = rows.data || [];
        const ids = schedulerRows.map((row:any)=>row.id);
        const runs = ids.length ? await client.from('cargomove_scheduler_runs').select('scheduler_id,status,requested_at,triggered_by').in('scheduler_id',ids).order('requested_at',{ascending:false}).limit(1000).timeout(8000) : {data:[],error:null};
        if (runs.error) return fail(503, 'Unable to load scheduler run history. Apply the scheduler gallery migration and refresh the database schema.');
        const latestByScheduler = new Map<string,any>();
        for (const run of runs.data || []) if (!latestByScheduler.has(run.scheduler_id)) latestByScheduler.set(run.scheduler_id,run);
        const schedulers = schedulerRows.map((row:any) => {
          const latest = latestByScheduler.get(row.id);
          return serialize({...row,lastRun:latest?{status:latest.status,requestedAt:latest.requested_at,triggeredBy:latest.triggered_by}:null});
        });
        return response.status(200).json({ schedulers });
      }
      const body = await requestBody(request).catch(() => null) as Record<string, unknown> | null;
      if (!body || Array.isArray(body)) return fail(400, 'Enter scheduler details.');
      const displayName = typeof body.displayName === 'string' ? body.displayName.trim() : '';
      const description = typeof body.description === 'string' ? body.description.trim() : '';
      const origin = typeof body.origin === 'string' ? body.origin.trim() : '';
      if (!displayName || displayName.length > 100 || description.length > 500) return fail(400, 'Enter a title up to 100 characters and a description up to 500 characters.');
      if (!origin || origin.length > 100) return fail(400, 'Enter a system origin up to 100 characters.');
      let target: ReturnType<typeof parseSchedulerUrl>;
      try { target = parseSchedulerUrl(body.url); } catch (error) { return fail(400, (error as Error).message); }
      const schedulerId = typeof body.id === 'string' ? body.id : '';
      if (request.method === 'PATCH' && !schedulerId) return fail(400, 'Choose a saved scheduler to update.');
      const query = request.method === 'PATCH'
        ? client.from('cargomove_schedulers').update({ display_name: displayName, description, origin, task_id: target.taskId, worker_name: target.workerName }).eq('id', schedulerId)
        : client.from('cargomove_schedulers').insert({ display_name: displayName, description, origin, task_id: target.taskId, worker_name: target.workerName, created_by: session.id });
      const saved = await query.select(FIELDS).timeout(8000).maybeSingle();
      if (request.method === 'PATCH' && !saved.error && !saved.data) return fail(404, 'Saved scheduler not found.');
      if (saved.error) return fail(saved.error.code === '23505' ? 409 : 503,
        saved.error.code === '23505' ? 'That scheduler ID or worker name is already saved.' : 'Unable to save the scheduler. Check the scheduler gallery migration.');
      return response.status(request.method === 'PATCH' ? 200 : 201).json({ scheduler: serialize(saved.data) });
    } catch { return fail(503, 'Scheduler gallery is temporarily unavailable.'); }
  };
}

export default createSchedulerCatalog();
