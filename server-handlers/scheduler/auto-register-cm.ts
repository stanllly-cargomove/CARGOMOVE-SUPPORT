import crypto from 'node:crypto';
import { adminClient, readSession, requestBody } from '../../api/_runtime.js';
import { createRegistrationUploadsHandler } from '../registration-uploads/handler.js';
import { uploadWorkbook, verifyWorkbook } from '../registration-uploads/automation.js';
import { createSchedulerHandler } from './handler.js';
import { runAutomation } from './automation.js';
import { allowedOrigin, schedulerAdmin } from './access.js';

const KEY = 'auto_register_cm';
const TERMINAL_UPLOAD = new Set(['SUCCESS', 'FAILED']);

function secretMatches(request: any): boolean {
  const expected = process.env.CRON_SECRET;
  const supplied = typeof request.headers?.authorization === 'string'
    ? request.headers.authorization.replace(/^Bearer\s+/i, '') : '';
  if (!expected || !supplied) return false;
  const left = Buffer.from(expected), right = Buffer.from(supplied);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function internalOrigin(): string {
  const configured = process.env.SCHEDULER_PORTAL_URL || process.env.APP_URL;
  if (configured) return new URL(configured).origin;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return 'http://localhost:3000';
}

function serializeRun(row: any) {
  return {
    id: row.id, executionType: row.execution_type, status: row.status,
    startedAt: row.started_at, finishedAt: row.finished_at, durationMs: row.duration_ms,
    processedCount: row.processed_count, successCount: row.success_count, failedCount: row.failed_count,
    message: row.message, errorMessage: row.error_message,
  };
}

function captureResponse() {
  return {
    code: 200, body: undefined as any, headers: {} as Record<string, string>,
    setHeader(name: string, value: string) { this.headers[name] = value; },
    status(code: number) { this.code = code; return this; },
    json(value: any) { this.body = value; return this; },
  };
}

const wait = (milliseconds: number) => new Promise(resolve => setTimeout(resolve, milliseconds));

export function createAutoRegisterCmHandler(deps = { adminClient, readSession, uploadWorkbook, verifyWorkbook, runAutomation }) {
  return async function autoRegisterCm(request: any, response: any) {
    response.setHeader('Cache-Control', 'no-store');
    const fail = (code: number, error: string) => response.status(code).json({ error });
    if (!['GET', 'PATCH', 'POST'].includes(request.method)) {
      response.setHeader('Allow', 'GET, PATCH, POST'); return fail(405, 'Method not allowed.');
    }

    const automatic = request.method === 'POST' && secretMatches(request);
    let access: any;
    if (automatic) {
      const client = deps.adminClient();
      if (!client) return fail(503, 'Scheduler database access is not configured.');
      const actor = await client.rpc<{ id: string; email: string }>('auto_register_cm_actor', {});
      if (actor.error || !actor.data?.id || !actor.data?.email) return fail(503, 'No administrator is available for the registration audit.');
      access = { client, session: { id: actor.data.id, email: actor.data.email, type: 'ADMIN' } };
    } else {
      access = await schedulerAdmin(request, deps);
      if ('code' in access) return fail(access.code, access.message);
      if (request.method !== 'GET' && (!allowedOrigin(request.headers.origin)
        || request.headers['sec-fetch-site'] === 'cross-site')) return fail(403, 'Request origin is invalid.');
    }
    const { client, session } = access;

    if (request.method === 'GET') {
      const [configuration, history] = await Promise.all([
        client.from('automation_schedulers').select('*').eq('scheduler_key', KEY).timeout(8000).maybeSingle(),
        client.from('automation_scheduler_runs').select('*').eq('scheduler_key', KEY).order('started_at', { ascending: false }).limit(50).timeout(8000),
      ]);
      if (configuration.error || !configuration.data || history.error) return fail(503, 'Unable to load Auto Register in CM. Apply the scheduler migration.');
      const row = configuration.data;
      return response.status(200).json({ scheduler: {
        key: row.scheduler_key, name: row.scheduler_name, description: row.description,
        schedule: row.schedule, isEnabled: row.is_enabled, lastRunAt: row.last_run_at,
        lastStatus: row.last_status, updatedAt: row.updated_at,
      }, runs: (history.data || []).map(serializeRun) });
    }

    const body = await requestBody(request).catch(() => null) as Record<string, unknown> | null;
    if (!body || Array.isArray(body)) return fail(400, 'Invalid request body.');
    if (request.method === 'PATCH') {
      if (request.headers['x-cargomove-confirm'] !== 'manage-auto-register-cm'
        || Object.keys(body).some(key => key !== 'isEnabled') || typeof body.isEnabled !== 'boolean') return fail(400, 'Choose an enabled status.');
      const saved = await client.from('automation_schedulers').update({ is_enabled: body.isEnabled, updated_at: new Date().toISOString() })
        .eq('scheduler_key', KEY).select('*').timeout(8000).maybeSingle();
      if (saved.error || !saved.data) return fail(503, 'Unable to update the scheduler status.');
      return response.status(200).json({ isEnabled: saved.data.is_enabled });
    }

    if (!automatic && (request.headers['x-cargomove-confirm'] !== 'run-auto-register-cm'
      || Object.keys(body).length)) return fail(403, 'Request confirmation is invalid.');
    if (automatic && Object.keys(body).length) return fail(400, 'The automatic trigger body must be empty.');

    const executionType = automatic ? 'AUTOMATIC' : 'MANUAL';
    const requestKey = automatic ? `${KEY}:${Math.floor(Date.now() / 7_200_000)}` : null;
    const acquired = await client.rpc('acquire_automation_scheduler', {
      p_scheduler_key: KEY, p_execution_type: executionType, p_actor: session.id, p_request_key: requestKey,
    });
    if (acquired.error || !acquired.data) return fail(503, 'Scheduler admission is unavailable. Apply the scheduler migration.');
    if (!acquired.data.id) return response.status(409).json({ status: 'skipped', message: 'Another Auto Register in CM execution is running.' });
    if (acquired.data.reason === 'disabled') return response.status(200).json({ executionId: acquired.data.id, status: 'skipped', message: 'Auto Register in CM is disabled.' });
    if (acquired.data.reason === 'duplicate') return response.status(200).json({ executionId: acquired.data.id,
      status: String(acquired.data.status || 'skipped').toLowerCase(), message: 'This two-hour schedule window was already handled.' });

    const executionId = acquired.data.id;
    // Leave enough headroom for a worst-case 65-second CargoMove browser step and
    // Vercel response/audit writes. Durable state is resumed by the next trigger.
    const workDeadline = Date.now() + 100_000;
    const finish = async (status: 'SUCCESS' | 'FAILED' | 'SKIPPED', counts: { processed: number; success: number; failed: number }, message: string, error?: string) => {
      const saved = await client.rpc('finish_automation_scheduler', { p_id: executionId, p_status: status,
        p_processed: counts.processed, p_success: counts.success, p_failed: counts.failed, p_message: message, p_error: error || null });
      if (saved.error || saved.data !== true) throw new Error('Execution result could not be saved.');
      return response.status(status === 'FAILED' ? 500 : 200).json({ executionId, status: status.toLowerCase(), message,
        processedCount: counts.processed, successCount: counts.success, failedCount: counts.failed });
    };

    try {
      const systemReadSession = () => session;
      const systemScheduler = createSchedulerHandler({ adminClient: () => client, readSession: systemReadSession, runAutomation: deps.runAutomation });
      const uploads = createRegistrationUploadsHandler({ adminClient: () => client, readSession: systemReadSession,
        uploadWorkbook: deps.uploadWorkbook, verifyWorkbook: deps.verifyWorkbook, runScheduler: systemScheduler });
      const callUploads = async (payload: Record<string, unknown>) => {
        const captured = captureResponse();
        await uploads({ method: 'POST', body: payload, headers: { origin: internalOrigin(), 'sec-fetch-site': 'same-origin',
          'x-cargomove-confirm': 'registration-upload' } }, captured);
        return captured;
      };

      const active = await client.from('registration_uploads').select('id,batch_id,state,created_at')
        .not('state', 'in', '(SUCCESS,FAILED)').order('created_at', { ascending: true }).limit(20).timeout(8000);
      if (active.error) throw new Error('Unable to inspect existing registration uploads.');
      const existing = active.data?.[0];
      let result: ReturnType<typeof captureResponse>;
      if (existing) {
        result = await callUploads({ action: 'check', jobId: existing.batch_id || existing.id });
      } else {
        const pending = await client.from('registration_submissions').select('id,registration_type,cargomove_upload')
          .eq('status', 'PENDING').in('registration_type', ['DRIVER', 'TRAILER', 'VEHICLE'])
          .order('submitted_at', { ascending: true }).limit(300).timeout(8000);
        if (pending.error) throw new Error('Unable to load pending registrations.');
        // Verified uploads remain Pending until the separate acceptance-email workflow completes.
        // Exclude them here so they cannot starve newer work (the database also prevents replay).
        const candidates = (pending.data || []).filter((row: any) => row.cargomove_upload?.state !== 'SUCCESS');
        const firstType = candidates[0]?.registration_type;
        const ids = candidates.filter((row: any) => row.registration_type === firstType).slice(0, 100).map((row: any) => row.id);
        if (!ids.length) return await finish('SKIPPED', { processed: 0, success: 0, failed: 0 }, 'No pending asset registrations are ready to process.');
        result = await callUploads({ action: 'start', submissionIds: ids });
      }

      if (result.code >= 400) {
        const message = result.body?.error || 'The registration batch could not be started.';
        return await finish(result.code === 409 ? 'SKIPPED' : 'FAILED', { processed: 0, success: 0, failed: 0 }, message,
          result.code === 409 ? undefined : message);
      }
      let submissions = result.body?.submissions || (result.body?.submission ? [result.body.submission] : []);
      let states = submissions.map((item: any) => item.cargomove_upload?.state).filter(Boolean);
      const jobId = submissions[0]?.cargomove_upload?.id;
      while (jobId && states.length && states.some((state: string) => !TERMINAL_UPLOAD.has(state))
        && Date.now() + 68_000 < workDeadline) {
        await wait(Math.min(10_000, Math.max(1_000, Number(result.body?.nextCheckMs) || 3_000)));
        result = await callUploads({ action: 'check', jobId });
        if (result.code >= 400) break;
        submissions = result.body?.submissions || (result.body?.submission ? [result.body.submission] : submissions);
        states = submissions.map((item: any) => item.cargomove_upload?.state).filter(Boolean);
      }
      const processed = submissions.length;
      const success = states.filter((state: string) => state === 'SUCCESS').length;
      const failed = states.filter((state: string) => state === 'FAILED').length;
      if (result.code >= 400) {
        const message = result.body?.error || 'Registration processing failed.';
        return await finish('FAILED', { processed, success, failed: Math.max(failed, processed - success) }, message, message);
      }
      if (failed) return await finish('FAILED', { processed, success, failed }, result.body?.submission?.cargomove_upload?.message || 'CargoMove rejected the registration batch.', 'One or more registrations failed.');
      const pendingCount = states.filter((state: string) => !TERMINAL_UPLOAD.has(state)).length;
      return await finish('SUCCESS', { processed, success, failed: 0 }, pendingCount
        ? `${processed} registration(s) were advanced safely; ${pendingCount} remain in verified processing and will resume on the next run.`
        : `${success} registration(s) were verified successfully in CargoMove.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Auto Register in CM failed.';
      try { return await finish('FAILED', { processed: 0, success: 0, failed: 0 }, message, message); }
      catch { return fail(503, `${message} The execution result could not be saved.`); }
    }
  };
}

export default createAutoRegisterCmHandler();
