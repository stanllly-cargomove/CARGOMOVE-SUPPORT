import { adminClient, readSession, requestBody } from '../../api/_runtime.js';
import type { RegistrationSubmission } from '../../src/types/index.js';
import { registrationUploadBlockReason } from '../registration-uploads/eligibility.js';
import { allowedOrigin, schedulerAdmin } from './access.js';
import { loadAutoRegistrationIndicators, loadPendingAutoRegistrations, scheduleEligibleAutoRegistrations } from './auto-register-cm-discovery.js';

const DETAIL_FIELDS = {
  DRIVER: (submission: RegistrationSubmission) => ({
    name: submission.data.drivers?.map(item => item.name).filter(Boolean).join(', ') || submission.data.driver?.name || '',
    drivingLicense: submission.data.drivers?.map(item => item.driving_license).filter(Boolean).join(', ') || submission.data.driver?.driving_license || '',
    mobile: submission.data.drivers?.map(item => item.mobile_no).filter(Boolean).join(', ') || submission.data.driver?.mobile_no || '',
  }),
  TRAILER: (submission: RegistrationSubmission) => ({
    registration: submission.data.trailers?.map(item => item.registration_number).filter(Boolean).join(', ') || submission.data.trailer?.registration_number || '',
    weight: submission.data.trailers?.map(item => item.weight).filter(Boolean).join(', ') || submission.data.trailer?.weight || '',
    trailerType: submission.data.trailers?.map(item => item.trailer_type).filter(Boolean).join(', ') || submission.data.trailer?.trailer_type || '',
    bdmWeight: submission.data.trailers?.map(item => item.bdm_weight).filter(Boolean).join(', ') || submission.data.trailer?.bdm_weight || '',
  }),
  VEHICLE: (submission: RegistrationSubmission) => ({
    registration: submission.data.vehicles?.map(item => item.registration_number).filter(Boolean).join(', ') || submission.data.vehicle?.registration_number || '',
    weight: submission.data.vehicles?.map(item => item.weight).filter(Boolean).join(', ') || submission.data.vehicle?.weight || '',
    bgkWeight: submission.data.vehicles?.map(item => item.bgk_weight).filter(Boolean).join(', ') || submission.data.vehicle?.bgk_weight || '',
    head: submission.data.vehicles?.map(item => item.head).filter(Boolean).join(', ') || submission.data.vehicle?.head || '',
  }),
} as const;

export function autoRegistrationRecordCount(submission: RegistrationSubmission) {
  return submission.registration_type === 'DRIVER'
    ? submission.data.drivers?.length || (submission.data.driver ? 1 : 0)
    : submission.registration_type === 'TRAILER'
      ? submission.data.trailers?.length || (submission.data.trailer ? 1 : 0)
      : submission.data.vehicles?.length || (submission.data.vehicle ? 1 : 0);
}

function serializeRegistration(submission: RegistrationSubmission, reason: string | null,
  indicators: Awaited<ReturnType<typeof loadAutoRegistrationIndicators>>) {
  const detail = DETAIL_FIELDS[submission.registration_type as keyof typeof DETAIL_FIELDS];
  const retry = indicators.rescheduled.get(submission.id);
  return {
    id: submission.id,
    referenceNo: submission.reference_no,
    registrationType: submission.registration_type,
    companyName: submission.company_name,
    companyRegNo: submission.company_reg_no,
    submittedAt: submission.submitted_at,
    submittedBy: submission.submitted_by_name,
    details: {
      ...(detail ? detail(submission) : {}),
      portLocation: submission.port_location,
      portId: submission.port_id || '',
      depotId: submission.depot_id || '',
    },
    recordCount: autoRegistrationRecordCount(submission),
    submission,
    eligible: !reason,
    reason,
    scheduled: indicators.scheduled.has(submission.id),
    queueStatus: indicators.failed.has(submission.id) ? 'FAILED' : retry ? 'RE-SCHEDULED' : 'SCHEDULED',
    firstFailureReason: retry?.reason || null,
    firstFailedAt: retry?.retryAt || null,
  };
}

export function createAutoRegisterCmQueueHandler(deps = { adminClient, readSession }) {
  return async function autoRegisterCmQueue(request: any, response: any) {
    response.setHeader('Cache-Control', 'no-store');
    const fail = (code: number, error: string) => response.status(code).json({ error });
    if (!['GET', 'POST'].includes(request.method)) {
      response.setHeader('Allow', 'GET, POST');
      return fail(405, 'Method not allowed.');
    }
    const access = await schedulerAdmin(request, deps);
    if ('code' in access) return fail(access.code, access.message);
    if (request.method === 'POST' && (!allowedOrigin(request.headers.origin)
      || request.headers['x-cargomove-confirm'] !== 'auto-schedule-auto-register-cm'
      || request.headers['sec-fetch-site'] === 'cross-site')) return fail(403, 'Request origin or confirmation is invalid.');
    const { client, session } = access;

    if (request.method === 'GET' && request.query?.view === 'scheduled') {
      try {
        const indicators = await loadAutoRegistrationIndicators(client);
        return response.status(200).json({
          scheduledSubmissionIds: [...new Set([...indicators.scheduled, ...indicators.rescheduled.keys()])],
          failedSubmissionIds: [...indicators.failed],
        });
      }
      catch (error) { return fail(503, error instanceof Error ? error.message : 'Unable to inspect the scheduled registration queue.'); }
    }

    const loadQueue = async () => {
      const [pending, ports, queued, history] = await Promise.all([
        loadPendingAutoRegistrations(client),
        client.from('port_configs').select('*').limit(1000).timeout(8000),
        loadAutoRegistrationIndicators(client),
        client.from('auto_register_cm_scheduled_items').select('*').order('scheduled_at', { ascending: false }).limit(5000).timeout(8000),
      ]);
      if (ports.error) throw new Error('Unable to load registration eligibility. Check the registration data and port configuration.');
      if (history.error) throw new Error('Unable to load Auto Register queue history. Apply the Auto Register queue migration.');

      const indicators = queued;
      const candidates = pending.sort((a, b) => a.submitted_at.localeCompare(b.submitted_at) || a.id.localeCompare(b.id));
      const registrations: ReturnType<typeof serializeRegistration>[] = [];
      for (let offset = 0; offset < candidates.length; offset += 8) {
        const checked = await Promise.all(candidates.slice(offset, offset + 8).map(async (submission: RegistrationSubmission) => {
          const reason = await registrationUploadBlockReason(client, submission, ports.data || []);
          return serializeRegistration(submission, reason, indicators);
        }));
        registrations.push(...checked);
      }
      return {
        registrations,
        history: (history.data || []).map((item: any) => ({
          id: item.id, submissionId: item.submission_id, referenceNo: item.reference_no, registrationType: item.registration_type,
          companyName: item.company_name, status: item.status, scheduledAt: item.scheduled_at,
          completedAt: item.completed_at, message: item.message, runId: item.run_id,
        })),
      };
    };

    if (request.method === 'GET') {
      try { return response.status(200).json(await loadQueue()); }
      catch (error) { return fail(503, error instanceof Error ? error.message : 'Unable to load Auto Register eligibility and queue history. Please retry.'); }
    }

    try {
      const body = await requestBody(request).catch(() => null) as Record<string, unknown> | null;
      if (!body || Array.isArray(body) || Object.keys(body).length) return fail(400, 'Automatic scheduling does not accept a request payload.');
      return response.status(200).json(await scheduleEligibleAutoRegistrations(client, session.id));
    } catch {
      return fail(503, 'Unable to verify or schedule the selected registrations. Please retry.');
    }
  };
}

export default createAutoRegisterCmQueueHandler();
