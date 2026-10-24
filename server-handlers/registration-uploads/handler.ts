import * as XLSX from 'xlsx';
import { adminClient, readSession, requestBody } from '../../api/_runtime.js';
import { allowedOrigin, schedulerAdmin } from '../scheduler/access.js';
import runScheduler from '../scheduler/handler.js';
import { SCHEDULER_ID } from '../scheduler/targets.js';
import { buildExcelRowData, validateSubmissionsForExport, type ExcelContext } from '../../shared/registration-excel.js';
import type { RegistrationSubmission } from '../../src/types/index.js';
import { uploadWorkbook, verifyWorkbook, type Verification } from './automation.js';
import { COMPANY_REGISTRATION_REQUIRED } from '../../shared/registration-eligibility.js';

type Job = { id: string; submission_id: string; entity: string; scheduler_id: string; state: string; filename: string;
  expected_rows: number; upload_id?: string; updated_at: string; created_at: string; success_count?: number; error_count?: number };
const dependencies = { adminClient, readSession, uploadWorkbook, verifyWorkbook, runScheduler };

export function createRegistrationUploadsHandler(deps = dependencies) {
  return async function registrationUploads(request: any, response: any) {
    response.setHeader('Cache-Control', 'no-store');
    const fail = (code: number, error: string) => response.status(code).json({ error });
    if (request.method !== 'POST') { response.setHeader('Allow', 'POST'); return fail(405, 'Method not allowed.'); }
    const access = await schedulerAdmin(request, deps);
    if ('code' in access) return fail(access.code, access.message);
    if (!allowedOrigin(request.headers.origin) || request.headers['x-cargomove-confirm'] !== 'registration-upload'
      || request.headers['sec-fetch-site'] === 'cross-site') return fail(403, 'Request origin or confirmation is invalid.');
    const body = await requestBody(request).catch(() => null) as Record<string, unknown> | null;
    if (!body || Array.isArray(body) || !['start', 'check'].includes(String(body.action))
      || Object.keys(body).some(key => !['action', 'submissionId', 'submissionIds', 'jobId'].includes(key))) return fail(400, 'Choose a registration upload action.');
    const username = process.env.CARGOMOVE_USERNAME, password = process.env.CARGOMOVE_PASSWORD;
    if (!username || !password) return fail(503, 'CargoMove server credentials are not configured.');
    const credentials = { username, password };
    const { client, session } = access;
    let job: Job | undefined;
    let token: string | undefined;
    const incomplete: string[] = [];
    const transition = async (state: string, message: string, extra: Record<string, unknown> = {}) => {
      const result = await client.rpc<Job>('transition_registration_upload_batch', {
        p_id: job!.id, p_token: token, p_state: state, p_message: message, ...extra,
      });
      if (result.error || !result.data) throw new Error();
      job = result.data;
    };
    const reply = async (nextCheckMs = 3000, download?: { filename: string; base64: string }, blocked = false) => {
      const members = await client.from('registration_uploads').select('submission_id').eq('batch_id', job!.id).timeout(8000);
      const ids = members.data?.length ? members.data.map((member: any) => member.submission_id) : [job!.submission_id];
      const rows = await Promise.all(ids.map((id: string) => client.from('registration_submissions').select('*').eq('id', id).timeout(8000).maybeSingle()));
      if (members.error || rows.some((row: any) => row.error || !row.data)) return fail(503, 'Upload progress was saved, but the registration could not be refreshed. Check its existing upload.');
      // Lease tokens and upstream account/session data never reach the browser.
      return response.status(200).json({ submission: rows[0].data, submissions: rows.map((row: any) => row.data), incomplete, nextCheckMs, ...(download ? { download } : {}), ...(blocked ? { blocked: true } : {}) });
    };
    try {
      if (body.action === 'start') {
        const ids = body.submissionIds ?? (body.submissionId ? [body.submissionId] : []);
        if (!Array.isArray(ids) || ids.length < 1 || ids.length > 100 || ids.some(id => typeof id !== 'string' || !id || id.length > 150) || body.jobId !== undefined)
          return fail(400, 'Select a registration.');
        const eligible: string[] = [];
        const preflightPorts = await client.from('port_configs').select('*').limit(1000).timeout(8000);
        if (preflightPorts.error) return fail(503, 'Port configuration could not be loaded.');
        const uniqueIds = [...new Set(ids)] as string[];
        // Bound concurrency so a larger selection fits the function's time budget.
        for (let offset = 0; offset < uniqueIds.length; offset += 8) {
          const checked = await Promise.all(uniqueIds.slice(offset, offset + 8).map(async id => {
            const source = await client.from('registration_submissions').select('*').eq('id', id).timeout(8000).maybeSingle();
            const sub = source.data as RegistrationSubmission | null;
            if (source.error || !sub) { incomplete.push(`${id}: registration unavailable.`); return null; }
            const approval = await client.rpc<string>('registration_upload_company_block_reason', { p_company_id: sub.company_id });
            const company = await client.from('companies').select('*').eq('id', sub.company_id).timeout(8000).maybeSingle();
            let reason = approval.error || company.error ? 'Company registration could not be verified.' : approval.data;
            if (!reason) {
              const context: ExcelContext = { companies: company.data ? [company.data] : [], ports: preflightPorts.data || [], depots: [] };
              const validation = validateSubmissionsForExport([sub], context);
              const { rows } = buildExcelRowData([sub], context);
              const required = sub.registration_type === 'DRIVER' ? ['DRIVINGLICENSE', 'MOBILENO', 'NAME'] : ['REGISTRATION', 'WEIGHT'];
              if (!validation.valid || !rows.length || rows.some(row => required.some(key => !String(row[key] ?? '').trim())
                || sub.registration_type !== 'DRIVER' && (!Number.isFinite(Number(row.WEIGHT)) || Number(row.WEIGHT) < 0)
                || row.PORTS.split(',').filter(Boolean).some(portId => !/^[a-f0-9]{24}$/i.test(portId)))) reason = 'Check CargoMove IDs, required fields, weights and port configuration.';
            }
            if (reason) { incomplete.push(`${sub.reference_no}: ${reason}`); return null; }
            return id;
          }));
          eligible.push(...checked.filter((id): id is string => !!id));
        }
        if (!eligible.length) return fail(409, incomplete.join('\n'));
        const acquired = await client.rpc<{ job: Job; token?: string; submissions: RegistrationSubmission[]; existing: boolean }>('begin_registration_upload_batch', {
          p_actor: session.id, p_submission_ids: eligible,
        });
        if (acquired.error || !acquired.data) {
          const reason = [COMPANY_REGISTRATION_REQUIRED].find(message => acquired.error?.message?.includes(message));
          return fail(409, reason || 'Unable to start this upload. Select a Pending asset registration and apply/configure the registration-upload migrations and saved processing scheduler.');
        }
        job = acquired.data.job;
        token = acquired.data.token;
        if (acquired.data.existing || !token) return reply();
        const subs = acquired.data.submissions;
        const companies = [];
        for (const companyId of new Set(subs.map(sub => sub.company_id))) {
          const approval = await client.rpc<string>('registration_upload_company_block_reason', { p_company_id: companyId });
          if (approval.error || approval.data) {
            await transition('FAILED', approval.data || 'Company registration could not be verified. No file was uploaded.');
            return reply(3000, undefined, true);
          }
          const company = await client.from('companies').select('*').eq('id', companyId).timeout(8000).maybeSingle();
          if (company.error || !company.data) throw new Error('Company unavailable');
          companies.push(company.data);
        }
        const ports = await client.from('port_configs').select('*').limit(1000).timeout(8000);
        if (ports.error) {
          await transition('FAILED', 'Failed to prepare the CargoMove upload. The company or port configuration could not be loaded.');
          return reply();
        }
        const context: ExcelContext = { companies, ports: ports.data || [], depots: [] };
        const validation = validateSubmissionsForExport(subs, context);
        const { headers, rows } = buildExcelRowData(subs, context);
        const validRows = rows.length > 0 && rows.length <= 1000 && rows.every(row => {
          const required = job!.entity === 'driver' ? ['DRIVINGLICENSE', 'MOBILENO', 'NAME'] : ['REGISTRATION', 'WEIGHT'];
          return required.every(key => String(row[key] || '').trim())
            && (job!.entity === 'driver' || Number.isFinite(Number(row.WEIGHT)) && Number(row.WEIGHT) >= 0)
            && row.PORTS.split(',').filter(Boolean).every(id => /^[a-f0-9]{24}$/i.test(id));
        });
        if (!validation.valid || !validRows) {
          await transition('FAILED', 'Failed to prepare the CargoMove upload. Check company IDs, required registration fields, weights and configured port IDs.');
          return reply();
        }
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([[...headers], ...rows.map(row => headers.map(header => row[header] ?? ''))]), 'Sheet1');
        const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
        if (buffer.length > 2 * 1024 * 1024) {
          await transition('FAILED', 'The registration workbook exceeds the 2 MB upload limit. Split the registration before uploading.');
          return reply();
        }
        const outcome = await deps.uploadWorkbook(credentials, job, buffer, async (evidence) => {
          await transition('UPLOADING', 'Uploading the merged registration workbook to CargoMove.', { p_expected_rows: rows.length,
            ...(evidence ? { p_existing_upload_ids: evidence.existingUploadIds, p_upload_started_at: evidence.startedAt } : {}) });
        });
        await transition(outcome.state, outcome.message, outcome.state === 'FAILED' ? { p_success_count: 0, p_error_count: 0 } : {});
        return reply(1000, { filename: job.filename, base64: buffer.toString('base64') });
      }
      if (typeof body.jobId !== 'string' || !SCHEDULER_ID.test(body.jobId) || body.submissionId !== undefined || body.submissionIds !== undefined)
        return fail(400, 'Choose an existing upload to verify.');
      const acquired = await client.rpc<{ job: Job; token?: string; busy?: boolean }>('claim_registration_upload_batch', { p_actor: session.id, p_id: body.jobId });
      if (acquired.error || !acquired.data) return fail(409, 'Unable to verify this upload. Refresh the registration queue.');
      job = acquired.data.job;
      token = acquired.data.token;
      if (acquired.data.busy || !token || ['SUCCESS', 'FAILED'].includes(job.state)) return reply();
      const result = await deps.verifyWorkbook(credentials, job);
      const extra = (value: Verification) => ({
        p_upload_id: value.uploadId ?? null, p_success_count: value.successCount ?? null, p_error_count: value.errorCount ?? null,
      });
      if (['SUCCESS', 'FAILED'].includes(result.state)) {
        await transition(result.state, result.message, extra(result));
        return reply();
      }
      // Only a known accepted upload can request a scheduler. UNKNOWN never redispatches.
      if (job.state === 'UPLOADED' && result.readyForScheduler) {
        const members = await client.from('registration_uploads').select('submission_id').eq('batch_id', job.id).timeout(8000);
        if (members.error) throw new Error('Batch unavailable');
        for (const member of members.data?.length ? members.data : [{ submission_id: job.submission_id }]) {
          const source = await client.from('registration_submissions').select('company_id,status').eq('id', member.submission_id).timeout(8000).maybeSingle();
          const approval = source.error || !source.data ? null
            : await client.rpc<string>('registration_upload_company_block_reason', { p_company_id: source.data.company_id });
          if (!approval || approval.error || approval.data || source.data?.status !== 'PENDING') {
            await transition('UPLOADED', approval?.data || 'Processing is blocked because a registration or its parent company changed.');
            return reply(3000, undefined, true);
          }
        }
        const saved = await client.from('cargomove_schedulers').select('id,worker_name,enabled').eq('id', job.scheduler_id).timeout(8000).maybeSingle();
        if (saved.error || !saved.data?.enabled || saved.data.worker_name !== 'process_file_uploads') {
          await transition('UNKNOWN', 'The saved file processing scheduler is unavailable or has changed target. Check the existing upload.');
          return reply();
        }
        await transition('DISPATCHING', 'Requesting the saved CargoMove file processing scheduler.', extra(result));
        const schedulerResponse = { code: 200, body: null as any, setHeader() {},
          status(code: number) { this.code = code; return this; }, json(value: any) { this.body = value; return this; } };
        await deps.runScheduler({ ...request, body: { schedulerId: job.scheduler_id },
          headers: { ...request.headers, 'x-cargomove-confirm': 'run-scheduler' } }, schedulerResponse);
        const executionId = schedulerResponse.body?.executionId;
        const runExtra = typeof executionId === 'string' && SCHEDULER_ID.test(executionId) ? { p_scheduler_run_id: executionId } : {};
        if (schedulerResponse.body?.status === 'trigger_requested') {
          await transition('PROCESSING', 'Processing requested. Waiting for this file’s verified result.', runExtra);
          return reply(5000);
        }
        if ([409, 429].includes(schedulerResponse.code) && !executionId) {
          // Shared cooldown / another active request: no dispatch occurred for this job.
          // Unresolved global UNKNOWN outcomes need operator reconciliation.
          if (/uncertain|unknown/i.test(schedulerResponse.body?.message || '')) {
            await transition('UNKNOWN', 'A scheduler request has an uncertain outcome. Check CargoMove before requesting another run.');
            return reply();
          }
          await transition('UPLOADED', 'File uploaded. Waiting for the shared scheduler to become available.');
          return reply(schedulerResponse.code === 429 ? 30000 : 10000);
        }
        await transition('UNKNOWN', 'CargoMove processing could not be confirmed. Check this uploaded file before retrying.', runExtra);
        return reply();
      }
      const waitingForListing = result.state === 'MISSING' && Date.now() - Date.parse(job.created_at) < 60000 && job.state === 'UPLOADED';
      const timedOut = Date.now() - Date.parse(job.created_at) > 10 * 60000;
      const nextState = waitingForListing ? 'UPLOADED' : result.state === 'UNKNOWN' || result.state === 'MISSING' || timedOut ? 'UNKNOWN' : 'PROCESSING';
      await transition(nextState, timedOut && nextState === 'UNKNOWN'
        ? 'CargoMove processing has not been confirmed. The registration remains Pending; check the existing file.' : result.message, extra(result));
      return reply(5000);
    } catch {
      // Persisted dispatch markers and leases prevent replay after an interrupted function.
      if (job && token && job.state === 'PREPARING') {
        try { await transition('FAILED', 'Failed to prepare this CargoMove upload. No file was uploaded.'); return await reply(); } catch { /* Keep the durable lease. */ }
      }
      return fail(503, 'The upload result could not be confirmed. Refresh and check the existing upload before retrying.');
    }
  };
}

export default createRegistrationUploadsHandler();
