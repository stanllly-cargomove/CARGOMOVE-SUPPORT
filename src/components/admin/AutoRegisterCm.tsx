import React, { useEffect, useState } from 'react';
import { ArrowLeft, Clock3, Loader2, Play, RefreshCw } from 'lucide-react';
import { notifyError, notifySuccess } from '../common/notifications';

type SchedulerRun = {
  id: string;
  executionId: string;
  executionType: 'AUTOMATIC' | 'MANUAL';
  status: 'RUNNING' | 'SUCCESS' | 'FAILED' | 'SKIPPED';
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  processedCount: number;
  successCount: number;
  failedCount: number;
  message: string;
  errorMessage: string | null;
};

type AutoScheduler = {
  name: string;
  description: string;
  schedule: string;
  isEnabled: boolean;
  lastRunAt: string | null;
  lastStatus: 'SUCCESS' | 'FAILED' | 'SKIPPED' | null;
};

type Registration = {
  id: string;
  referenceNo: string;
  registrationType: 'DRIVER' | 'TRAILER' | 'VEHICLE';
  companyName: string;
  companyRegNo: string;
  submittedAt: string;
  submittedBy: string;
  details: Record<string, string>;
  eligible: boolean;
  reason: string | null;
  scheduled: boolean;
};

type QueueHistory = {
  submissionId: string;
  id: string;
  referenceNo: string;
  registrationType: string;
  companyName: string;
  status: 'SCHEDULED' | 'SUCCESS' | 'FAIL';
  scheduledAt: string;
  completedAt: string | null;
  message: string;
  runId: string | null;
};

const malaysiaDate = (value: string | Date) => new Intl.DateTimeFormat('en-MY', {
  timeZone: 'Asia/Kuala_Lumpur', dateStyle: 'medium', timeStyle: 'short',
}).format(typeof value === 'string' ? new Date(value) : value);

const nextTwoHourRun = () => new Date((Math.floor(Date.now() / 7_200_000) + 1) * 7_200_000);
const statusTone = (status: string) => status === 'SUCCESS' ? 'bg-emerald-50 text-emerald-700'
  : status === 'FAIL' || status === 'FAILED' ? 'bg-rose-50 text-rose-700'
    : status === 'SCHEDULED' || status === 'RUNNING' ? 'bg-blue-50 text-blue-700'
      : 'bg-amber-50 text-amber-700';
const registrationBlockReason = (reason: string | null) => {
  if (!reason) return 'Registration requirements are incomplete.';
  if (reason.toLowerCase().includes('company registration status must be registered')
    || reason.toLowerCase().includes('register the parent company')) return 'Parent company is not registered.';
  return reason;
};
const registrationTag = (registration: Registration) => {
  const details = registration.details;
  const primary = details.registration || details.drivingLicense || details.name;
  if (primary) return primary;
  return registration.registrationType === 'DRIVER' ? 'Driver details'
    : registration.registrationType === 'TRAILER' ? 'Trailer details' : 'Vehicle details';
};

async function readJson(response: Response, fallback: string) {
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error || data?.message || fallback);
  return data;
}

export function AutoRegisterCmToggle({ onChanged }: { onChanged?: (enabled: boolean) => void }) {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/scheduler/auto-register-cm', { credentials: 'same-origin' });
      const data = await readJson(response, 'Unable to load Auto Register in CM settings.');
      if (typeof data?.scheduler?.isEnabled !== 'boolean') throw new Error('Auto Register in CM settings are unavailable.');
      setEnabled(data.scheduler.isEnabled);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to load Auto Register in CM settings.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const toggle = async () => {
    if (enabled === null || saving) return;
    const next = !enabled;
    setSaving(true);
    setError('');
    try {
      const response = await fetch('/api/scheduler/auto-register-cm', {
        method: 'PATCH',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'X-CargoMove-Confirm': 'manage-auto-register-cm' },
        body: JSON.stringify({ isEnabled: next }),
      });
      const data = await readJson(response, 'Unable to update the scheduler.');
      if (typeof data?.isEnabled !== 'boolean') throw new Error('The scheduler did not confirm its updated status.');
      setEnabled(data.isEnabled);
      onChanged?.(data.isEnabled);
      notifySuccess(`Auto Register in CM ${data.isEnabled ? 'enabled' : 'disabled'}.`);
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'Unable to update the scheduler.';
      setError(message);
      notifyError(message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex shrink-0 flex-col items-end gap-1">
      {loading ? <span role="status" className="inline-flex h-6 w-11 items-center justify-center text-slate-400"><Loader2 className="h-4 w-4 animate-spin" /></span>
        : <button type="button" role="switch" aria-label="Enable Auto Register in CM" aria-checked={Boolean(enabled)}
          disabled={saving || enabled === null} onClick={() => void toggle()}
          className={`relative ml-auto inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2 disabled:opacity-60 ${enabled ? 'bg-emerald-600' : 'bg-slate-300'}`}>
          <span className={`inline-flex h-4 w-4 items-center justify-center rounded-full bg-white shadow-sm transition-transform ${enabled ? 'translate-x-6' : 'translate-x-1'}`}>
            {saving && <Loader2 className="h-3 w-3 animate-spin text-slate-500" />}
          </span>
        </button>}
      {error && <button type="button" onClick={() => void load()} className="max-w-40 text-right text-[10px] font-semibold text-rose-700 hover:underline" aria-label="Retry loading Auto Register in CM settings">{error}</button>}
    </div>
  );
}

export function AutoRegisterCmPage({ onBack }: { onBack: () => void }) {
  const [scheduler, setScheduler] = useState<AutoScheduler | null>(null);
  const [runs, setRuns] = useState<SchedulerRun[]>([]);
  const [registrations, setRegistrations] = useState<Registration[]>([]);
  const [history, setHistory] = useState<QueueHistory[]>([]);
  const [registrationTab, setRegistrationTab] = useState<'scheduled' | 'ineligible'>('scheduled');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    void (async () => {
      try {
        const [schedulerResponse, scheduleResponse] = await Promise.all([
          fetch('/api/scheduler/auto-register-cm', { credentials: 'same-origin', signal: controller.signal }),
          fetch('/api/scheduler/auto-register-cm-queue', {
            method: 'POST',
            credentials: 'same-origin',
            signal: controller.signal,
            headers: { 'Content-Type': 'application/json', 'X-CargoMove-Confirm': 'auto-schedule-auto-register-cm' },
            body: '{}',
          }),
        ]);
        const [schedulerData, scheduleData] = await Promise.all([
          readJson(schedulerResponse, 'Unable to load Auto Register in CM.'),
          readJson(scheduleResponse, 'Unable to automatically schedule eligible registrations.'),
        ]);
        if (typeof scheduleData?.scheduled !== 'number') throw new Error('The queue did not confirm automatic scheduling.');
        const queueResponse = await fetch('/api/scheduler/auto-register-cm-queue', { credentials: 'same-origin', signal: controller.signal });
        const queueData = await readJson(queueResponse, 'Unable to load the scheduled registration queue.');
        if (!schedulerData?.scheduler || !Array.isArray(schedulerData.runs)
          || !Array.isArray(queueData.registrations) || !Array.isArray(queueData.history)) {
          throw new Error('Auto Register returned incomplete scheduler or registration data.');
        }
        if (!controller.signal.aborted) {
          setScheduler(schedulerData.scheduler);
          setRuns(schedulerData.runs);
          setRegistrations(queueData.registrations);
          setHistory(queueData.history);
        }
      } catch (reason) {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Unable to load Auto Register in CM.');
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [refresh]);

  const eligible = registrations.filter(registration => registration.eligible && !registration.scheduled);
  const ineligible = registrations.filter(registration => !registration.eligible);
  const scheduledRegistrations = registrations.filter(registration => registration.eligible);
  const queuedRegistrationCount = scheduledRegistrations.filter(registration => registration.scheduled).length;

  const runNow = async () => {
    if (running || !queuedRegistrationCount || !window.confirm(`Run ${queuedRegistrationCount} scheduled registration${queuedRegistrationCount === 1 ? '' : 's'} in CargoMove now${scheduler?.isEnabled ? '' : ' while automatic scheduling is OFF'}?`)) return;
    setRunning(true);
    try {
      const response = await fetch('/api/scheduler/auto-register-cm', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'X-CargoMove-Confirm': 'run-auto-register-cm' },
        body: '{}',
      });
      const data = await readJson(response, 'Auto Register in CM failed.');
      if (data.status === 'failed') notifyError(data.message);
      else notifySuccess(data.message || 'Auto Register in CM completed.');
      setRefresh(value => value + 1);
    } catch (reason) {
      notifyError(reason instanceof Error ? reason.message : 'Auto Register in CM failed.');
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="w-full space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <button type="button" onClick={onBack} aria-label="Back to Developer Settings"
            className="mt-0.5 rounded-lg p-2 text-slate-500 hover:bg-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          </button>
          <div>
            <h2 className="text-xl font-bold tracking-tight text-slate-900">Auto Register in CM</h2>
            <p className="mt-1 max-w-2xl text-xs leading-5 text-slate-500">Review registrations, manage automatic scheduling, and track every result.</p>
          </div>
        </div>
        <div className="flex gap-2 pl-11 sm:pl-0">
          <button type="button" onClick={() => setRefresh(value => value + 1)} disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />Refresh
          </button>
        </div>
      </div>

      {error && <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
        <p>{error}</p><button type="button" onClick={() => setRefresh(value => value + 1)} className="mt-2 font-semibold underline">Try again</button>
      </div>}
      {loading && <p role="status" className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white p-4 text-xs text-slate-500"><Loader2 className="h-4 w-4 animate-spin" />Loading scheduler, registration eligibility and logs…</p>}

      {!loading && !error && scheduler && <>
        <section aria-label="Auto Register schedule overview" className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-sm font-bold text-slate-900">{scheduler.name}</h3>
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${scheduler.isEnabled ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>{scheduler.isEnabled ? 'Enabled' : 'Disabled'}</span>
              </div>
              <p className="mt-1 text-xs text-slate-600">{scheduler.description}</p>
              <p className="mt-2 inline-flex items-center gap-1.5 text-[11px] font-semibold text-slate-600"><Clock3 className="h-3.5 w-3.5" />Runs {scheduler.schedule}</p>
            </div>
            <div className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 sm:flex-row sm:items-center sm:justify-between lg:min-w-[360px]">
              <div className="min-w-0">
                <p className="text-xs font-bold text-slate-800">Automatic scheduling</p>
                <p className="mt-0.5 text-[10px] leading-4 text-slate-500">
                  {scheduler.isEnabled ? 'Eligible registrations run on schedule.' : 'Queued registrations wait until scheduling is enabled.'}
                </p>
              </div>
              <div className="flex shrink-0 items-center justify-between gap-3">
                <AutoRegisterCmToggle onChanged={isEnabled => setScheduler(current => current ? { ...current, isEnabled } : current)} />
                <button type="button" onClick={() => void runNow()} disabled={running || loading || !queuedRegistrationCount}
                  title={queuedRegistrationCount ? 'Run scheduled registrations now' : 'There are no scheduled registrations to run'}
                  className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-xs font-bold text-white shadow-sm hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50">
                  {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}{running ? 'Running…' : 'Run Now'}
                </button>
              </div>
            </div>
          </div>
          <div className="mt-4 grid gap-2 sm:grid-cols-4">
            <div className="rounded-lg bg-slate-50 px-3 py-2"><span className="block text-[10px] text-slate-500">Last execution</span><strong className="mt-0.5 block text-xs text-slate-800">{scheduler.lastRunAt ? malaysiaDate(scheduler.lastRunAt) : 'Never'}</strong></div>
            <div className="rounded-lg bg-slate-50 px-3 py-2"><span className="block text-[10px] text-slate-500">Next scheduled run</span><strong className="mt-0.5 block text-xs text-slate-800">{scheduler.isEnabled ? malaysiaDate(nextTwoHourRun()) : 'Not scheduled'}</strong></div>
            <div className="rounded-lg bg-slate-50 px-3 py-2"><span className="block text-[10px] text-slate-500">Eligible now</span><strong className="mt-0.5 block text-xs text-slate-800">{eligible.length} registration{eligible.length === 1 ? '' : 's'}</strong></div>
            <div className="rounded-lg bg-slate-50 px-3 py-2"><span className="block text-[10px] text-slate-500">Last result</span><strong className={`mt-0.5 block text-xs ${statusTone(scheduler.lastStatus || '')}`}>{scheduler.lastStatus || 'No runs'}</strong></div>
          </div>
        </section>

        <section aria-label="Registrations">
          <div role="tablist" aria-label="Registration status" className="ml-[0.5px] flex w-fit items-end">
            <button type="button" role="tab" aria-selected={registrationTab === 'scheduled'} aria-controls="auto-register-registrations-panel"
              onClick={() => setRegistrationTab('scheduled')}
              style={{ whiteSpace: 'nowrap', ...(registrationTab === 'scheduled' ? { backgroundColor: '#009966', color: '#fff', borderColor: '#009966', borderBottomColor: 'transparent' } : {}) }}
              className={`admin-registration-tab auto-register-status-tab auto-register-scheduled-tab relative -mr-px flex h-10 min-w-[152px] items-center justify-center whitespace-nowrap rounded-t-lg border px-2 text-[9px] font-bold uppercase tracking-wide transition-none sm:px-3 sm:text-xs sm:tracking-wider ${registrationTab === 'scheduled' ? 'z-10' : 'border-slate-300 bg-[#F1F5F9] text-slate-500 hover:bg-slate-200 hover:text-slate-900'}`}>
              Scheduled registrations ({scheduledRegistrations.length})
            </button>
            <button type="button" role="tab" aria-selected={registrationTab === 'ineligible'} aria-controls="auto-register-registrations-panel"
              onClick={() => setRegistrationTab('ineligible')}
              style={{ whiteSpace: 'nowrap', ...(registrationTab === 'ineligible' ? { backgroundColor: '#EC003F', color: '#fff', borderColor: '#EC003F', borderBottomColor: 'transparent' } : {}) }}
              className={`admin-registration-tab auto-register-status-tab auto-register-ineligible-tab relative -mr-px flex h-10 min-w-[152px] items-center justify-center whitespace-nowrap rounded-t-lg border px-2 text-[9px] font-bold uppercase tracking-wide transition-none sm:px-3 sm:text-xs sm:tracking-wider ${registrationTab === 'ineligible' ? 'z-10' : 'border-slate-300 bg-[#F1F5F9] text-slate-500 hover:bg-slate-200 hover:text-slate-900'}`}>
              Non-eligible Registration ({ineligible.length})
            </button>
          </div>
          <div data-testid="auto-register-tab-divider" aria-hidden="true" style={{ height: 1, backgroundColor: '#cbd5e1' }} className="w-full" />
          <div id="auto-register-registrations-panel" role="tabpanel" className="overflow-hidden rounded-b-xl rounded-tr-xl border-x border-b border-slate-200 bg-white shadow-sm">
            <div className="overflow-x-auto" style={{ overflowX: 'auto' }}>
              <table aria-label={registrationTab === 'scheduled' ? 'Scheduled registrations' : 'Non-eligible registrations'} className="w-full min-w-[760px] table-fixed border-collapse text-left text-[11px]">
                <thead>
                  <tr
                    style={{ backgroundColor: registrationTab === 'scheduled' ? '#009966' : '#EC003F', borderColor: registrationTab === 'scheduled' ? '#009966' : '#EC003F' }}
                    className={`admin-registration-table-header auto-register-registration-header-${registrationTab} whitespace-nowrap border-x border-b border-slate-400 text-[10px] font-bold uppercase tracking-wide text-white`}
                  >
                    <th scope="col" style={{ whiteSpace: 'nowrap' }} className="px-3 py-2">Registration No.</th><th scope="col" style={{ whiteSpace: 'nowrap' }} className="px-3 py-2">Registration Type</th><th scope="col" style={{ whiteSpace: 'nowrap' }} className="px-3 py-2">Company</th><th scope="col" style={{ whiteSpace: 'nowrap' }} className="px-3 py-2">{registrationTab === 'scheduled' ? 'Registration details' : 'Reasons'}</th>
                    {registrationTab === 'scheduled' && <th scope="col" style={{ whiteSpace: 'nowrap' }} className="px-3 py-2">Reg schedule</th>}</tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {(registrationTab === 'scheduled' ? scheduledRegistrations : ineligible).map(registration => {
                    const queued = history.find(item => item.submissionId === registration.id && item.status === 'SCHEDULED');
                    return <tr key={registration.id} className="align-middle hover:bg-slate-50/70">
                      <td className="whitespace-nowrap px-3 py-3 font-semibold text-slate-800">{registration.referenceNo}</td>
                      <td className="px-3 py-3 text-slate-600">{registration.registrationType}</td>
                      <td className="max-w-56 px-3 py-3"><strong className="block truncate text-slate-700" title={registration.companyName}>{registration.companyName}</strong></td>
                      <td className="px-3 py-3">{registrationTab === 'ineligible'
                        ? <span className="text-[10px] leading-4 text-rose-700">{registrationBlockReason(registration.reason)}</span>
                        : <span className="inline-flex max-w-48 truncate rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-[10px] font-medium text-slate-600" title={registrationTag(registration)}>{registrationTag(registration)}</span>}
                      </td>
                      {registrationTab === 'scheduled' && <td className="px-3 py-3">{registration.scheduled
                        ? <span className="inline-flex flex-col"><span className="w-fit rounded-full bg-blue-50 px-2 py-1 text-[10px] font-bold text-blue-700">Scheduled</span><span className="mt-1 whitespace-nowrap text-[10px] text-slate-500">{queued ? malaysiaDate(queued.scheduledAt) : 'Next automatic run'}</span></span>
                        : <span className="text-[10px] text-slate-500">{scheduler.isEnabled ? 'Waiting for schedule' : 'Waiting for scheduler to be enabled'}</span>}
                      </td>}
                    </tr>;
                  })}
                  {registrationTab === 'scheduled' && !scheduledRegistrations.length && <tr><td colSpan={5} className="px-4 py-10 text-center text-xs text-slate-500">No eligible registrations to schedule.</td></tr>}
                  {registrationTab === 'ineligible' && !ineligible.length && <tr><td colSpan={4} className="px-4 py-10 text-center text-xs text-slate-500">There are no non-eligible registrations.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <section aria-label="Execution logs" className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 bg-slate-50/70 px-3 py-3">
            <h3 className="text-sm font-bold text-slate-900">Execution logs</h3>
          </div>
          <div className="overflow-x-auto" style={{ overflowX: 'auto' }}>
            <table aria-label="Auto Register in CM execution logs" className="w-full min-w-[1180px] text-left text-[11px]">
              <thead className="bg-slate-100 text-[10px] font-bold uppercase tracking-wide text-slate-600"><tr><th className="px-3 py-2">Execution</th><th className="px-3 py-2">Execution ID</th><th className="px-3 py-2">Registration ID</th><th className="px-3 py-2">Started (MYT)</th><th className="px-3 py-2">Status</th><th className="px-3 py-2 text-right">Duration</th><th className="px-3 py-2 text-right">Processed</th><th className="px-3 py-2 text-right">Success</th><th className="px-3 py-2 text-right">Failed</th><th className="px-3 py-2">Message</th></tr></thead>
              <tbody className="divide-y divide-slate-100">{runs.map(run => <tr key={run.id}>
                <td className="px-3 py-2 font-semibold text-slate-700">{run.executionType === 'AUTOMATIC' ? 'Automatic' : 'Manual'}</td>
                <td className="whitespace-nowrap px-3 py-2 font-mono text-[10px] text-slate-700">{run.executionId}</td>
                <td className="px-3 py-2 font-mono text-[10px] text-slate-700">
                  {history.filter(item => item.runId === run.id).length
                    ? history.filter(item => item.runId === run.id).map(item => <span key={item.id} className="block whitespace-nowrap">{item.referenceNo}</span>)
                    : <span>—</span>}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-slate-600">{malaysiaDate(run.startedAt)}</td>
                <td className="px-3 py-2"><span className={`rounded-full px-2 py-1 text-[10px] font-bold ${statusTone(run.status)}`}>{run.status}</span></td>
                <td className="px-3 py-2 text-right text-slate-600">{run.durationMs == null ? '—' : `${(run.durationMs / 1000).toFixed(1)}s`}</td>
                <td className="px-3 py-2 text-right">{run.processedCount}</td><td className="px-3 py-2 text-right text-emerald-700">{run.successCount}</td>
                <td className="px-3 py-2 text-right text-rose-700">{run.failedCount}</td>
                <td className="max-w-80 truncate px-3 py-2 text-slate-600" title={run.errorMessage || run.message}>{run.errorMessage || run.message || '—'}</td>
              </tr>)}
              {!runs.length && <tr><td colSpan={10} className="px-4 py-8 text-center text-xs text-slate-500">No execution history yet.</td></tr>}</tbody>
            </table>
          </div>
        </section>
      </>}
    </div>
  );
}
