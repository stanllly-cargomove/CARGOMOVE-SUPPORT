import crypto from 'node:crypto';
import { adminClient, readSession, requestBody } from '../../api/_runtime.js';
import { createRegistrationUploadsHandler } from '../registration-uploads/handler.js';
import { uploadWorkbook, verifyWorkbook } from '../registration-uploads/automation.js';
import { createSchedulerHandler } from './handler.js';
import { runAutomation } from './automation.js';
import { allowedOrigin, schedulerAdmin } from './access.js';
import { scheduleEligibleAutoRegistrations } from './auto-register-cm-discovery.js';
import { completeAutoRegistrationEmails } from './auto-register-cm-email.js';
import { signedCronMatches } from './cron-signature.js';

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

function serializeRun(row: any, registrationReferences: string[] = []) {
  return {
    id: row.id, executionId: row.execution_reference, executionType: row.execution_type, status: row.status,
    startedAt: row.started_at, finishedAt: row.finished_at, durationMs: row.duration_ms,
    processedCount: row.processed_count, successCount: row.success_count, failedCount: row.failed_count,
    message: row.message, errorMessage: row.error_message, registrationReferences,
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

    const signedBody = request.method === 'POST' && typeof request.headers?.['x-cargomove-cron-signature'] === 'string'
      ? await requestBody(request).catch(() => null) : undefined;
    const automatic = request.method === 'POST' && (secretMatches(request) || signedCronMatches(request.headers, signedBody));
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
      const [configuration, history, lastAutomatic, cronState] = await Promise.all([
        client.from('automation_schedulers').select('*').eq('scheduler_key', KEY).timeout(8000).maybeSingle(),
        client.from('automation_scheduler_runs').select('*').eq('scheduler_key', KEY).order('started_at', { ascending: false }).limit(100).timeout(8000),
        client.from('automation_scheduler_runs').select('started_at,chain_started_at,status').eq('scheduler_key', KEY)
          .eq('execution_type', 'AUTOMATIC').order('started_at', { ascending: false }).limit(1).timeout(8000).maybeSingle(),
        client.from('auto_register_cm_cron_state').select('is_enabled,last_tick_at,last_status,last_error_code')
          .eq('scheduler_key', KEY).timeout(8000).maybeSingle(),
      ]);
      if (configuration.error || !configuration.data || history.error) return fail(503, 'Unable to load Auto Register in CM. Apply the scheduler migration.');
      const referencesByRun = new Map<string, Set<string>>();
      const runIds = (history.data || []).map((row: any) => row.id);
      if (runIds.length) {
        for (let offset = 0; ; offset += 500) {
          const items = await client.from('automation_scheduler_run_items')
            .select('run_id,scheduled_item_id,auto_register_cm_scheduled_items(reference_no)')
            .in('run_id', runIds).order('run_id', { ascending: true }).order('scheduled_item_id', { ascending: true })
            .range(offset, offset + 499).timeout(8000);
          if (items.error) return fail(503, 'Unable to load registration execution history. Apply the Auto Register reliability migrations.');
          for (const item of items.data || []) {
            const refs = referencesByRun.get(item.run_id) || new Set<string>();
            if (item.auto_register_cm_scheduled_items?.reference_no) refs.add(item.auto_register_cm_scheduled_items.reference_no);
            referencesByRun.set(item.run_id, refs);
          }
          if ((items.data || []).length < 500) break;
        }
      }
      const row = configuration.data;
      return response.status(200).json({ scheduler: {
        key: row.scheduler_key, name: row.scheduler_name, description: row.description,
        schedule: row.schedule, isEnabled: row.is_enabled, lastRunAt: row.last_run_at,
        lastStatus: row.last_status, updatedAt: row.updated_at,
        lastAutomaticRunAt: lastAutomatic.error ? undefined : lastAutomatic.data?.chain_started_at || lastAutomatic.data?.started_at || null,
        cronTrigger: cronState.error || !cronState.data ? null : { isEnabled: cronState.data.is_enabled,
          lastTickAt: cronState.data.last_tick_at, status: cronState.data.last_status, errorCode: cronState.data.last_error_code },
      }, runs: (history.data || []).map((row: any) => serializeRun(row, [...referencesByRun.get(row.id) || []])) });
    }

    const body = (signedBody !== undefined ? signedBody : await requestBody(request).catch(() => null)) as Record<string, unknown> | null;
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
    if (automatic && (Object.keys(body).some(key => !['window', 'continuationToken'].includes(key))
      || body.window !== undefined && (!Number.isSafeInteger(body.window) || Math.abs(Number(body.window) - Math.floor(Date.now() / 1_200_000)) > 1)
      || body.continuationToken !== undefined && (typeof body.continuationToken !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.continuationToken))
      || body.window !== undefined && body.continuationToken !== undefined)) return fail(400, 'Invalid automatic delivery or continuation.');

    const executionType = automatic ? 'AUTOMATIC' : 'MANUAL';
    const requestKey = automatic ? `${KEY}:delivery:${body.window ?? Math.floor(Date.now() / 1_200_000)}` : null;
    const acquired = automatic
      ? await client.rpc('acquire_auto_register_cm_step', { p_actor: session.id, p_request_key: requestKey, p_continuation: body.continuationToken || null })
      : await client.rpc('acquire_automation_scheduler', { p_scheduler_key: KEY, p_execution_type: executionType, p_actor: session.id, p_request_key: requestKey });
    if (acquired.error || !acquired.data) return fail(503, 'Scheduler admission is unavailable. Apply the scheduler migration.');
    if (acquired.data.reason === 'invalid_continuation') return fail(410, 'The continuation expired or is invalid. Work will resume on the next scheduled delivery.');
    if (!acquired.data.id || acquired.data.reason === 'duplicate' && acquired.data.status === 'RUNNING') return response.status(409).json({ status: 'skipped', message: 'Another Auto Register in CM execution is running.' });
    if (acquired.data.reason === 'disabled') return response.status(200).json({ executionId: acquired.data.id, status: 'skipped', message: 'Auto Register in CM is disabled.' });
    if (acquired.data.reason === 'duplicate') return response.status(200).json({ executionId: acquired.data.id,
      status: String(acquired.data.status || 'skipped').toLowerCase(), message: acquired.data.message || 'This twenty-minute delivery window was already handled.',
      continuationToken: acquired.data.continuationToken || null, continuationDelayMs: acquired.data.continuationDelayMs || 5000 });

    const executionId = acquired.data.id;
    // Leave enough headroom for a worst-case 65-second CargoMove browser step and
    // Vercel response/audit writes. Durable state is resumed by the next trigger.
    const workDeadline = Date.now() + 100_000;
    let emailCompleted = 0;
    const emailIssues = new Set<string>();
    const attemptedEmails = new Set<string>();
    const completeEmails = async () => {
      if (Date.now() + 25_000 >= workDeadline) return;
      const result = await completeAutoRegistrationEmails(client, session, workDeadline, undefined, attemptedEmails);
      emailCompleted += result.completed;
      result.issues.forEach(issue => emailIssues.add(issue));
    };
    const finish = async (status: 'SUCCESS' | 'FAILED' | 'SKIPPED', counts: { processed: number; success: number; failed: number }, message: string, error?: string) => {
      if (!automatic && status !== 'FAILED') await completeEmails();
      if (emailCompleted) {
        if (status === 'SKIPPED') status = 'SUCCESS';
        message += ` ${emailCompleted} acceptance email(s) completed; registrations moved to Done.`;
      }
      if (emailIssues.size) {
        status = 'FAILED';
        error = [...emailIssues].join(' ').slice(0, 1000);
        message += ` ${emailIssues.size} acceptance email(s) need attention: ${error}`;
      }
      let hasMore = false;
      if (automatic && status !== 'FAILED') {
        const remaining = await client.rpc('auto_register_cm_has_work', {});
        if (remaining.error || typeof remaining.data !== 'boolean') throw new Error('Unable to inspect remaining automatic work.');
        hasMore = remaining.data;
      }
      const saved = await client.rpc(automatic ? 'finish_auto_register_cm_step' : 'finish_automation_scheduler', { p_id: executionId, p_status: status,
        p_processed: counts.processed, p_success: counts.success, p_failed: counts.failed, p_message: message, p_error: error || null,
        ...(automatic ? { p_has_more: hasMore } : {}) });
      if (saved.error || !saved.data || !automatic && saved.data !== true) throw new Error('Execution result could not be saved.');
      return response.status(status === 'FAILED' ? 500 : 200).json({ executionId, status: status.toLowerCase(), message,
        processedCount: counts.processed, successCount: counts.success, failedCount: counts.failed,
        ...(automatic ? saved.data : {}) });
    };

    try {
      // Recover previously verified Pending registrations before browser work
      // consumes this invocation's budget.
      if (!automatic) await completeEmails();
      // Discovery runs under scheduler admission, including when no administrator
      // opens the page. Its durable cursor resumes on the next bounded scan.
      await scheduleEligibleAutoRegistrations(client, session.id, { deadline: Math.min(workDeadline - 68_000, Date.now() + (automatic ? 5_000 : 20_000)) });
      if (automatic) {
        // Email preparation/sending uses its own request, never the headroom
        // left after CargoMove browser work.
        await completeEmails();
        if (attemptedEmails.size) return await finish('SUCCESS', { processed: 0, success: 0, failed: 0 },
          'Acceptance email completion checked for verified registrations.');
      }
      if (Date.now() + 68_000 >= workDeadline) {
        return await finish('SKIPPED', { processed: 0, success: 0, failed: 0 },
          'Eligible registrations were queued. Processing will continue on the next run.');
      }
      const systemReadSession = () => session;
      const systemScheduler = createSchedulerHandler({ adminClient: () => client, readSession: systemReadSession,
        runAutomation: automatic ? (credentials, beforeDispatch, launch, _budget, target) =>
          deps.runAutomation(credentials, beforeDispatch, launch, 30_000, target) : deps.runAutomation });
      const uploads = createRegistrationUploadsHandler({ adminClient: () => client, readSession: systemReadSession,
        uploadWorkbook: deps.uploadWorkbook,
        verifyWorkbook: automatic ? (credentials, job) => deps.verifyWorkbook(credentials, job, undefined, 45_000) : deps.verifyWorkbook,
        runScheduler: systemScheduler });
      const callUploads = async (payload: Record<string, unknown>) => {
        const captured = captureResponse();
        await uploads({ method: 'POST', body: payload, headers: { origin: internalOrigin(), 'sec-fetch-site': 'same-origin',
          'x-cargomove-confirm': 'registration-upload' } }, captured);
        return captured;
      };

      const scheduled = await client.from('auto_register_cm_scheduled_items')
          .select('id,submission_id,registration_type,reference_no').eq('status', 'SCHEDULED')
          .order('last_attempted_at', { ascending: true, nullsFirst: true })
          .order('scheduled_at', { ascending: true }).limit(1000).timeout(8000);
      if (scheduled.error) throw new Error('Unable to load the saved Auto Register queue.');
      const scheduledItems = scheduled.data || [];
      if (!scheduledItems.length) {
        return await finish('SKIPPED', { processed: 0, success: 0, failed: 0 }, emailIssues.size
          ? 'CargoMove registration is complete; acceptance emails remain pending.'
          : 'No scheduled registrations are ready to process.');
      }

      const processGroup = async (scheduledIds: string[]) => {
        const finish = async (status: 'SUCCESS' | 'FAILED' | 'SKIPPED', counts: { processed: number; success: number; failed: number }, message: string, error?: string) =>
          ({ status, counts, message, error });

        // Restrict resumptions as well as new batches to registrations explicitly
        // placed in this queue. Other uploads belong to their own workflow.
        const active = await client.from('registration_uploads').select('id,batch_id,state,created_at,submission_id')
          .in('submission_id', scheduledIds).not('state', 'in', '(SUCCESS,FAILED)')
          .order('created_at', { ascending: true }).limit(20).timeout(8000);
        if (active.error) throw new Error('Unable to inspect scheduled registration uploads.');
        const existing = active.data?.[0];
        if (existing?.batch_id) {
          const members = await client.from('registration_uploads').select('submission_id').eq('batch_id', existing.batch_id).timeout(8000);
          if (members.error) throw new Error('Unable to inspect the existing registration batch.');
          const memberIds = new Set((members.data || []).map((item: any) => item.submission_id));
          scheduledIds = scheduledIds.filter(id => memberIds.has(id));
        } else if (existing) {
          scheduledIds = scheduledIds.filter(id => id === existing.submission_id);
        }
        const claimed = await client.from('auto_register_cm_scheduled_items').update({ run_id: executionId, last_attempted_at: new Date().toISOString() })
          .in('submission_id', scheduledIds).eq('status', 'SCHEDULED').timeout(8000);
        if (claimed.error) throw new Error('Unable to link scheduled registrations to this run.');
        if (Date.now() + 68_000 >= workDeadline) {
          return await finish('SKIPPED', { processed: 0, success: 0, failed: 0 },
            'Registrations remain scheduled. Processing will continue on the next run.');
        }

        let result: ReturnType<typeof captureResponse>;
        if (existing) {
          result = await callUploads({ action: 'check', jobId: existing.batch_id || existing.id });
        } else {
          result = await callUploads({ action: 'start', submissionIds: scheduledIds });
        }

        const markQueueFailures = async (failures: { submissionId: string; message: string }[]) => {
          for (const item of scheduledItems) {
            if (!scheduledIds.includes(item.submission_id)) continue;
            const issue = failures.find(failure => failure.submissionId === item.submission_id)?.message;
            if (!issue) continue;
            const saved = await client.from('auto_register_cm_scheduled_items').update({
              status: 'FAILED', completed_at: new Date().toISOString(), message: issue.slice(0, 500),
            }).eq('submission_id', item.submission_id).eq('status', 'SCHEDULED').select('id').timeout(8000);
            if (saved.error) throw new Error(`Unable to save scheduled status for ${item.reference_no}.`);
          }
        };
        const registrationFailures: { submissionId: string; message: string }[] = Array.isArray(result.body?.registrationFailures)
          ? result.body.registrationFailures : [];
        await markQueueFailures(registrationFailures);
        if (result.code >= 400) {
          const message = result.body?.error || 'The registration batch could not be started.';
          // An HTTP conflict or unavailable service is not a terminal registration
          // result. Only identified validation failures leave the durable queue.
          const failedCount = scheduledIds.filter((id: string) => registrationFailures.some(item => item.submissionId === id)).length;
          return await finish(result.code === 409 && !failedCount ? 'SKIPPED' : 'FAILED',
            { processed: failedCount, success: 0, failed: failedCount }, message,
            result.code === 409 ? undefined : message);
        }
        if (result.body?.retryable) {
          return await finish('FAILED', { processed: 0, success: 0, failed: 0 },
            'Registration preparation was temporarily unavailable. Scheduled registrations will be checked again.');
        }
        let submissions = result.body?.submissions || (result.body?.submission ? [result.body.submission] : []);
        let states = submissions.map((item: any) => item.cargomove_upload?.state).filter(Boolean);
        const jobId = submissions[0]?.cargomove_upload?.id;
        while (!automatic && jobId && states.length && states.some((state: string) => !TERMINAL_UPLOAD.has(state))
          && Date.now() + 68_000 < workDeadline) {
          await wait(Math.min(10_000, Math.max(1_000, Number(result.body?.nextCheckMs) || 3_000)));
          if (Date.now() + 68_000 >= workDeadline) break;
          result = await callUploads({ action: 'check', jobId });
          if (result.code >= 400) break;
          submissions = result.body?.submissions || (result.body?.submission ? [result.body.submission] : submissions);
          states = submissions.map((item: any) => item.cargomove_upload?.state).filter(Boolean);
          if (Array.isArray(result.body?.registrationFailures)) {
            registrationFailures.push(...result.body.registrationFailures);
            await markQueueFailures(result.body.registrationFailures);
          }
        }
        if (result.body?.retryable) {
          return await finish('FAILED', { processed: 0, success: 0, failed: 0 },
            'Registration preparation was temporarily unavailable. Scheduled registrations will be checked again.');
        }
        const queuedFailures = scheduledItems.filter((item: any) => scheduledIds.includes(item.submission_id)
          && registrationFailures.some(failure => failure.submissionId === item.submission_id));
        const processed = submissions.length + queuedFailures.length;
        const success = states.filter((state: string) => state === 'SUCCESS').length;
        const failed = states.filter((state: string) => state === 'FAILED').length + queuedFailures.length;
        for (const submission of submissions) {
          const state = submission.cargomove_upload?.state;
          if (state !== 'SUCCESS' && state !== 'FAILED') continue;
          const saved = await client.from('auto_register_cm_scheduled_items').update({
            status: state === 'SUCCESS' ? 'SUCCESS' : 'FAILED',
            completed_at: new Date().toISOString(),
            message: String(submission.cargomove_upload?.message || (state === 'SUCCESS' ? 'Registration completed successfully.' : 'Registration failed.')).slice(0, 500),
          }).eq('submission_id', submission.id).eq('status', 'SCHEDULED').select('id').timeout(8000);
          if (saved.error) throw new Error(`Unable to save scheduled status for ${submission.reference_no}.`);
        }
        if (result.code >= 400) {
          const message = result.body?.error || 'Registration processing failed.';
          return await finish('FAILED', { processed, success, failed }, message, message);
        }
        if (failed) {
          const message = queuedFailures.length
            ? `${queuedFailures.length} scheduled registration(s) failed eligibility checks.`
            : result.body?.submission?.cargomove_upload?.message || 'CargoMove rejected the registration batch.';
          return await finish('FAILED', { processed, success, failed }, message, 'One or more registrations failed.');
        }
        if (states.includes('UNKNOWN')) return await finish('FAILED', { processed, success, failed: 0 },
          'An existing CargoMove upload has an uncertain result. Review its audit before continuing; no file was uploaded again.');
        const pendingCount = states.filter((state: string) => !TERMINAL_UPLOAD.has(state)).length;
        return await finish('SUCCESS', { processed, success, failed: 0 }, pendingCount
          ? `${pendingCount} registration(s) are awaiting confirmation from CargoMove. The next ${automatic ? 'workflow request' : 'run'} will check the existing uploads.`
          : `${success} registration(s) were verified successfully in CargoMove.`);
      };

      const totals = { processed: 0, success: 0, failed: 0 };
      const messages: string[] = [];
      const errors: string[] = [];
      let outcome: 'SUCCESS' | 'FAILED' | 'SKIPPED' = 'SKIPPED';
      // Try each type once per invocation, preserving separate CM workbooks.
      // A slow batch remains durable; it must not hide another asset type.
      for (const type of [...new Set(scheduledItems.map((item: any) => item.registration_type))]) {
        const ids = scheduledItems.filter((item: any) => item.registration_type === type).slice(0, 100).map((item: any) => item.submission_id);
        if (Date.now() + 68_000 >= workDeadline) {
          messages.push('Remaining registrations will continue on the next delivery.');
          break;
        }
        const result = await processGroup(ids);
        totals.processed += result.counts.processed;
        totals.success += result.counts.success;
        totals.failed += result.counts.failed;
        messages.push(result.message);
        if (result.error) errors.push(result.error);
        if (result.status === 'FAILED' || outcome !== 'FAILED' && result.status === 'SUCCESS') outcome = result.status;
        if (automatic) break;
      }
      return await finish(outcome, totals, messages.join(' '), errors.join(' ') || undefined);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Auto Register in CM failed.';
      try { return await finish('FAILED', { processed: 0, success: 0, failed: 0 }, message, message); }
      catch { return fail(503, `${message} The execution result could not be saved.`); }
    }
  };
}

export default createAutoRegisterCmHandler();
