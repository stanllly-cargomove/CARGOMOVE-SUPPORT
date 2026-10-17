import { adminClient, readSession, requestBody } from '../../api/_runtime.js';
import { runAutomation, SCHEDULER, type Outcome } from './automation.js';
import { allowedOrigin, schedulerAdmin } from './access.js';
import { DEFAULT_SCHEDULER_ID, SCHEDULER_ID, schedulerUrl } from './targets.js';
export { allowedOrigin } from './access.js';

export function createSchedulerHandler(deps = { adminClient, readSession, runAutomation }) {
  return async function handler(request: any, response: any) {
    response.setHeader('Cache-Control', 'no-store');
    const timestamp = new Date().toISOString();
    let workerName = SCHEDULER;
    const reply = (code: number, message: string, status = 'FAILED', extra = {}) => response.status(code).json({
      success: status === 'TRIGGER_REQUESTED', scheduler: workerName, timestamp, status: status.toLowerCase(), message, ...extra,
    });
    if (request.method !== 'POST') { response.setHeader('Allow', 'POST'); return reply(405, 'Method not allowed.'); }
    const access = await schedulerAdmin(request, deps);
    if ('code' in access) return reply(access.code, access.message);
    if (!allowedOrigin(request.headers.origin)) return reply(403, 'Portal origin is not allowed. Set SCHEDULER_PORTAL_URL to the admin portal URL in Vercel and redeploy.');
    const confirmation = request.headers['x-cargomove-confirm'];
    if (!['run-scheduler', 'run-northport-containers'].includes(confirmation)
      || request.headers['sec-fetch-site'] === 'cross-site') return reply(403, 'Request confirmation is invalid.');
    const { client, session } = access;
    let runId: string | undefined;
    try {
      const body = request.body == null && confirmation === 'run-northport-containers'
        ? {} : await requestBody(request).catch(() => null) as Record<string, unknown> | null;
      if (!body || Array.isArray(body) || Object.keys(body).some(key => key !== 'schedulerId')) return reply(400, 'Supply only a saved scheduler ID.');
      const schedulerId = body.schedulerId ?? (confirmation === 'run-northport-containers' ? DEFAULT_SCHEDULER_ID : null);
      if (typeof schedulerId !== 'string' || !SCHEDULER_ID.test(schedulerId)) return reply(400, 'Select a saved scheduler from the gallery.');
      const username = process.env.CARGOMOVE_USERNAME;
      const password = process.env.CARGOMOVE_PASSWORD;
      if (!username || !password) return reply(503, 'CargoMove credentials are not configured on the server.');
      const acquired = await client.rpc<{ id?: string; reason?: string; cooldown_seconds?: number; worker_name?: string; task_id?: string }>('acquire_saved_cargomove_scheduler', { p_actor: session.id, p_scheduler_id: schedulerId });
      if (acquired.error || !acquired.data) return reply(503, 'Scheduler protection is unavailable. Apply the scheduler gallery database migration.');
      if (!acquired.data.id) {
        const reason = acquired.data.reason;
        if (reason === 'unavailable') return reply(404, 'The saved scheduler is missing or disabled. Refresh the gallery.');
        return reply(reason === 'cooldown' ? 429 : 409, reason === 'cooldown'
          ? acquired.data.cooldown_seconds === 45 ? 'Please wait 45 seconds between scheduler requests.' : 'Please wait five minutes between scheduler requests.'
          : reason === 'unknown' ? 'A previous request has an uncertain outcome. An operator must check CargoMove and resolve the audit record before another run.'
          : 'Another scheduler request is already running.');
      }
      runId = acquired.data.id;
      const target = { taskId: acquired.data.task_id || '', workerName: acquired.data.worker_name || '' };
      schedulerUrl(target); // Validate the database target before opening a browser.
      workerName = target.workerName;
      const outcome: Outcome = await deps.runAutomation({ username, password }, async () => {
        const marked = await client.rpc<boolean>('mark_cargomove_scheduler_dispatch', { p_id: runId });
        if (marked.error || marked.data !== true) throw new Error('Dispatch audit unavailable');
      }, undefined, undefined, target);
      const saved = await client.rpc<boolean>('finish_cargomove_scheduler', { p_id: runId, p_status: outcome.status, p_message: outcome.message });
      if (saved.error || saved.data !== true) return reply(502, 'Unable to save the final result. Check CargoMove and the execution audit before another run.', 'UNKNOWN', { executionId: runId });
      return reply(outcome.status === 'TRIGGER_REQUESTED' ? 200 : 502, outcome.message, outcome.status, { executionId: runId });
    } catch {
      // Leave an acquired lock in place; expiry becomes UNKNOWN, never an automatic retry.
      return reply(503, runId ? 'Execution outcome is uncertain. Check CargoMove and the audit history before another run.' : 'Scheduler service is temporarily unavailable.', runId ? 'UNKNOWN' : 'FAILED');
    }
  };
}

export default createSchedulerHandler();
