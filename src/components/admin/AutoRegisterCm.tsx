import React, { useEffect, useState } from 'react';
import { ArrowLeft, Clock3, Loader2, Play, Search } from 'lucide-react';
import { notifyError, notifySuccess } from '../common/notifications';
import type { RegistrationSubmission } from '../../types';
import { SubmissionDetailModal } from './SubmissionDetailModal';

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
  registrationReferences: string[];
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
  recordCount: number;
  submission: RegistrationSubmission;
  eligible: boolean;
  reason: string | null;
  scheduled: boolean;
  queueStatus: 'SCHEDULED' | 'RE-SCHEDULED' | 'FAILED';
  firstFailureReason: string | null;
  firstFailedAt: string | null;
};

type QueueHistory = {
  submissionId: string;
  id: string;
  referenceNo: string;
  registrationType: string;
  companyName: string;
  status: 'SCHEDULED' | 'SUCCESS' | 'FAILED';
  scheduledAt: string;
  completedAt: string | null;
  message: string;
  runId: string | null;
};

type AutoRegisterSnapshot = {
  scheduler: AutoScheduler;
  runs: SchedulerRun[];
  registrations: Registration[];
  history: QueueHistory[];
};

const autoRegisterCache = new Map<string, { refreshVersion: number; snapshot: AutoRegisterSnapshot }>();

const malaysiaDate = (value: string | Date) => new Intl.DateTimeFormat('en-MY', {
  timeZone: 'Asia/Kuala_Lumpur', dateStyle: 'medium', timeStyle: 'short',
}).format(typeof value === 'string' ? new Date(value) : value);

const nextTwoHourRun = () => new Date((Math.floor(Date.now() / 7_200_000) + 1) * 7_200_000);
const statusTone = (status: string) => status === 'SUCCESS' ? 'bg-emerald-50 text-emerald-700'
  : status === 'FAILED' ? 'bg-rose-50 text-rose-700'
    : status === 'SCHEDULED' || status === 'RUNNING' ? 'bg-blue-50 text-blue-700'
      : 'bg-amber-50 text-amber-700';
const registrationBlockReason = (reason: string | null) => {
  if (!reason) return 'Registration requirements are incomplete.';
  if (reason.toLowerCase().includes('company registration status must be registered')
    || reason.toLowerCase().includes('register the parent company')) return 'Parent company is not registered.';
  return reason;
};
function CompactPager({ page, pages, onPage, label }: { page: number; pages: number; onPage: (page: number) => void; label: string }) {
  return (
    <nav aria-label={label} className="flex items-center justify-center gap-2 border-t border-slate-200 bg-slate-50/70 px-3 py-2">
      <button type="button" aria-label={`Previous ${label.toLowerCase()} page`} disabled={page === 1} onClick={() => onPage(page - 1)}
        className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 bg-white text-xs font-bold text-slate-600 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40">&lt;</button>
      <span aria-current="page" className="min-w-7 text-center text-xs font-semibold text-slate-700">{page}</span>
      <button type="button" aria-label={`Next ${label.toLowerCase()} page`} disabled={page === pages} onClick={() => onPage(page + 1)}
        className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 bg-white text-xs font-bold text-slate-600 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40">&gt;</button>
    </nav>
  );
}

function AutoRegisterCmSkeleton() {
  return <div role="status" aria-label="Preparing Auto Register in CM" className="space-y-5 motion-safe:animate-pulse">
    <span className="sr-only">Preparing your Auto Register workspace.</span>
    <div aria-hidden="true" className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between gap-4"><div className="space-y-2"><div className="h-4 w-40 rounded bg-slate-200" /><div className="h-3 w-64 max-w-full rounded bg-slate-100" /></div><div className="h-10 w-32 rounded-lg bg-slate-100" /></div>
      <div className="mt-5 grid gap-2 sm:grid-cols-4">{Array.from({ length: 4 }, (_, index) => <div key={index} className="h-14 rounded-lg bg-slate-100" />)}</div>
    </div>
    <div aria-hidden="true" className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="h-10 w-72 max-w-[80%] rounded-t-lg bg-slate-200" />
      <div className="h-9 bg-slate-100" />
      {Array.from({ length: 6 }, (_, index) => <div key={index} className="grid grid-cols-4 gap-5 border-t border-slate-100 px-4 py-4"><span className="h-3 rounded bg-slate-200" /><span className="h-3 rounded bg-slate-100" /><span className="h-3 rounded bg-slate-100" /><span className="h-3 rounded bg-slate-100" /></div>)}
    </div>
  </div>;
}

async function readJson(response: Response, fallback: string) {
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error || data?.message || fallback);
  return data;
}

export function AutoRegisterCmToggle({ onChanged, value, cacheScope }: {
  onChanged?: (enabled: boolean) => void;
  value?: boolean;
  cacheScope?: string;
}) {
  const [enabled, setEnabled] = useState<boolean | null>(value ?? null);
  const [loading, setLoading] = useState(value === undefined);
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

  useEffect(() => {
    if (value !== undefined) {
      setEnabled(value);
      setLoading(false);
      return;
    }
    void load();
  }, [value]);

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
      const cachedEntry = cacheScope ? autoRegisterCache.get(cacheScope) : undefined;
      if (cacheScope && cachedEntry) autoRegisterCache.set(cacheScope, { ...cachedEntry, snapshot: {
        ...cachedEntry.snapshot, scheduler: { ...cachedEntry.snapshot.scheduler, isEnabled: data.isEnabled },
      } });
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

export function AutoRegisterCmPage({ onBack, cacheScope = 'default', refreshVersion = 0 }: {
  onBack: () => void;
  cacheScope?: string;
  refreshVersion?: number;
}) {
  const cached = autoRegisterCache.get(cacheScope)?.snapshot;
  const [scheduler, setScheduler] = useState<AutoScheduler | null>(cached?.scheduler ?? null);
  const [runs, setRuns] = useState<SchedulerRun[]>(cached?.runs ?? []);
  const [registrations, setRegistrations] = useState<Registration[]>(cached?.registrations ?? []);
  const [history, setHistory] = useState<QueueHistory[]>(cached?.history ?? []);
  const [registrationTab, setRegistrationTab] = useState<'scheduled' | 'ineligible'>('scheduled');
  const [loading, setLoading] = useState(!cached);
  const [error, setError] = useState('');
  const [localRefresh, setLocalRefresh] = useState(0);
  const [running, setRunning] = useState(false);
  const [registrationPage, setRegistrationPage] = useState(1);
  const [activeSubmission, setActiveSubmission] = useState<RegistrationSubmission | null>(null);
  const [logSearch, setLogSearch] = useState('');
  const [logPageSize, setLogPageSize] = useState(25);
  const [logPage, setLogPage] = useState(1);

  useEffect(() => {
    const cachedEntry = autoRegisterCache.get(cacheScope);
    const hadCachedData = Boolean(cachedEntry?.snapshot);
    if (!localRefresh && cachedEntry?.refreshVersion === refreshVersion) {
      setScheduler(cachedEntry.snapshot.scheduler);
      setRuns(cachedEntry.snapshot.runs);
      setRegistrations(cachedEntry.snapshot.registrations);
      setHistory(cachedEntry.snapshot.history);
      setLoading(false);
      setError('');
      return;
    }
    const controller = new AbortController();
    if (!cachedEntry) setLoading(true);
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
          const snapshot = {
            scheduler: schedulerData.scheduler,
            runs: schedulerData.runs,
            registrations: queueData.registrations,
            history: queueData.history,
          };
          autoRegisterCache.set(cacheScope, { refreshVersion, snapshot });
          setScheduler(snapshot.scheduler);
          setRuns(snapshot.runs);
          setRegistrations(snapshot.registrations);
          setHistory(snapshot.history);
        }
      } catch (reason) {
        if (!controller.signal.aborted) {
          const message = reason instanceof Error ? reason.message : 'Unable to load Auto Register in CM.';
          if (hadCachedData) notifyError(message);
          else setError(message);
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [cacheScope, localRefresh, refreshVersion]);

  const ineligible = registrations.filter(registration => !registration.eligible);
  const scheduledRegistrations = registrations.filter(registration => registration.eligible && registration.queueStatus !== 'FAILED');
  const queuedRegistrationCount = scheduledRegistrations.filter(registration => registration.scheduled).length;
  const activeRegistrations = registrationTab === 'scheduled' ? scheduledRegistrations : ineligible;
  const registrationPages = Math.max(1, Math.ceil(activeRegistrations.length / 10));
  const currentRegistrationPage = Math.min(registrationPage, registrationPages);
  const pagedRegistrations = activeRegistrations.slice((currentRegistrationPage - 1) * 10, currentRegistrationPage * 10);
  const normalizedLogSearch = logSearch.trim().toLowerCase();
  const filteredRuns = runs.filter(run => {
    if (!normalizedLogSearch) return true;
    const registrationReferences = (run.registrationReferences || []).join(' ');
    return [run.executionType, run.executionId, run.status, malaysiaDate(run.startedAt), run.message, run.errorMessage || '',
      run.processedCount, run.successCount, run.failedCount, registrationReferences]
      .some(value => String(value).toLowerCase().includes(normalizedLogSearch));
  });
  const logPages = Math.max(1, Math.ceil(filteredRuns.length / logPageSize));
  const currentLogPage = Math.min(logPage, logPages);
  const pagedRuns = filteredRuns.slice((currentLogPage - 1) * logPageSize, currentLogPage * logPageSize);

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
      setLocalRefresh(value => value + 1);
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
      </div>

      {error && <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
        <p>{error}</p><button type="button" onClick={() => setLocalRefresh(value => value + 1)} className="mt-2 font-semibold underline">Try again</button>
      </div>}
      {loading && <AutoRegisterCmSkeleton />}

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
                <AutoRegisterCmToggle value={scheduler.isEnabled} cacheScope={cacheScope} onChanged={isEnabled => {
                  setScheduler(current => {
                    if (!current) return current;
                    const next = { ...current, isEnabled };
                    const entry = autoRegisterCache.get(cacheScope);
                    if (entry) autoRegisterCache.set(cacheScope, { ...entry, snapshot: { ...entry.snapshot, scheduler: next } });
                    return next;
                  });
                }} />
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
            <div className="rounded-lg bg-slate-50 px-3 py-2"><span className="block text-[10px] text-slate-500">Eligible now</span><strong className="mt-0.5 block text-xs text-slate-800">{scheduledRegistrations.length} registration{scheduledRegistrations.length === 1 ? '' : 's'}</strong></div>
            <div className="rounded-lg bg-slate-50 px-3 py-2"><span className="block text-[10px] text-slate-500">Last result</span><strong className={`mt-0.5 block text-xs ${statusTone(scheduler.lastStatus || '')}`}>{scheduler.lastStatus || 'No runs'}</strong></div>
          </div>
        </section>

        <section aria-label="Registrations">
          <div role="tablist" aria-label="Registration status" className="ml-[0.5px] flex w-fit items-end">
            <button type="button" role="tab" aria-selected={registrationTab === 'scheduled'} aria-controls="auto-register-registrations-panel"
              onClick={() => { setRegistrationTab('scheduled'); setRegistrationPage(1); }}
              style={{ whiteSpace: 'nowrap', ...(registrationTab === 'scheduled' ? { backgroundColor: '#009966', color: '#fff', borderColor: '#009966', borderBottomColor: 'transparent' } : {}) }}
              className={`admin-registration-tab auto-register-status-tab auto-register-scheduled-tab relative -mr-px flex h-10 min-w-[152px] items-center justify-center whitespace-nowrap rounded-t-lg border px-2 text-[9px] font-bold uppercase tracking-wide transition-none sm:px-3 sm:text-xs sm:tracking-wider ${registrationTab === 'scheduled' ? 'z-10' : 'border-slate-300 bg-[#F1F5F9] text-slate-500 hover:bg-slate-200 hover:text-slate-900'}`}>
              Scheduled registrations ({scheduledRegistrations.length})
            </button>
            <button type="button" role="tab" aria-selected={registrationTab === 'ineligible'} aria-controls="auto-register-registrations-panel"
              onClick={() => { setRegistrationTab('ineligible'); setRegistrationPage(1); }}
              style={{ whiteSpace: 'nowrap', ...(registrationTab === 'ineligible' ? { backgroundColor: '#EC003F', color: '#fff', borderColor: '#EC003F', borderBottomColor: 'transparent' } : {}) }}
              className={`admin-registration-tab auto-register-status-tab auto-register-ineligible-tab relative -mr-px flex h-10 min-w-[152px] items-center justify-center whitespace-nowrap rounded-t-lg border px-2 text-[9px] font-bold uppercase tracking-wide transition-none sm:px-3 sm:text-xs sm:tracking-wider ${registrationTab === 'ineligible' ? 'z-10' : 'border-slate-300 bg-[#F1F5F9] text-slate-500 hover:bg-slate-200 hover:text-slate-900'}`}>
              Non-eligible Registration ({ineligible.length})
            </button>
          </div>
          <div data-testid="auto-register-tab-divider" aria-hidden="true" style={{ height: 1, backgroundColor: '#cbd5e1' }} className="w-full" />
          <div id="auto-register-registrations-panel" role="tabpanel" className="overflow-hidden rounded-b-xl rounded-tr-xl border-x border-b border-slate-200 bg-white shadow-sm">
            <div data-testid="registration-table-viewport" className="overflow-hidden" style={{ minHeight: 410 }}>
              <table aria-label={registrationTab === 'scheduled' ? 'Scheduled registrations' : 'Non-eligible registrations'} style={{ tableLayout: 'fixed', width: '100%', maxWidth: '100%' }} className="w-full table-fixed border-collapse text-left text-[11px]">
                <thead>
                  <tr
                    style={{ backgroundColor: registrationTab === 'scheduled' ? '#009966' : '#EC003F', borderColor: registrationTab === 'scheduled' ? '#009966' : '#EC003F' }}
                    className={`admin-registration-table-header auto-register-registration-header-${registrationTab} border-x border-b border-slate-400 text-[10px] font-bold uppercase tracking-wide text-white`}
                  >
                    <th scope="col" style={{ width: registrationTab === 'scheduled' ? '15%' : '17%' }} className="break-words px-2 py-2">Registration No.</th><th scope="col" style={{ width: registrationTab === 'scheduled' ? '14%' : '16%' }} className="break-words px-2 py-2 text-center">Registration Type</th><th scope="col" style={{ width: registrationTab === 'scheduled' ? '20%' : '23%' }} className="break-words px-2 py-2">Company</th><th scope="col" style={{ width: registrationTab === 'scheduled' ? '20%' : '44%' }} className="break-words px-2 py-2 text-center">{registrationTab === 'scheduled' ? 'Registration details' : 'Reasons'}</th>
                    {registrationTab === 'scheduled' && <><th scope="col" style={{ width: '15%' }} className="break-words px-2 py-2 text-center">Status</th><th scope="col" style={{ width: '16%' }} className="break-words px-2 py-2 text-center">Reg schedule</th></>}</tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {pagedRegistrations.map(registration => {
                    const queued = history.find(item => item.submissionId === registration.id && item.status === 'SCHEDULED');
                    const schedule = registration.scheduled
                      ? queued ? malaysiaDate(queued.scheduledAt) : 'Next automatic run'
                      : registration.queueStatus === 'RE-SCHEDULED' && registration.firstFailedAt
                        ? malaysiaDate(new Date((Math.floor(Date.parse(registration.firstFailedAt) / 7_200_000) + 1) * 7_200_000))
                      : scheduler.isEnabled ? 'Waiting for schedule' : 'Waiting for scheduler to be enabled';
                    return <tr key={registration.id} className="h-9 align-middle hover:bg-slate-50/70">
                      <td className="px-2 py-1">
                        <button type="button" onClick={() => setActiveSubmission(registration.submission)}
                          className="block max-w-full truncate rounded px-1 py-1 text-left font-mono font-bold text-slate-900 transition-colors hover:bg-slate-100 hover:text-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                          aria-label={`Review ${registration.referenceNo}`}>
                          {registration.referenceNo}
                        </button>
                      </td>
                      <td className="px-3 py-1 text-center text-slate-600"><span className="block truncate" title={registration.registrationType}>{registration.registrationType}</span></td>
                      <td className="max-w-56 px-3 py-1"><strong className="block truncate text-slate-700" title={registration.companyName}>{registration.companyName}</strong></td>
                      <td className="px-3 py-1 text-center">{registrationTab === 'ineligible'
                        ? <span className="block truncate text-[10px] leading-4 text-rose-700" title={registrationBlockReason(registration.reason)}>{registrationBlockReason(registration.reason)}</span>
                        : <span className="inline-flex h-6 w-24 items-center justify-center rounded-full border border-slate-200 bg-slate-50 px-2 text-[10px] font-bold text-slate-600">{registration.recordCount} RECORD</span>}
                      </td>
                      {registrationTab === 'scheduled' && <td className="px-2 py-1 text-center">
                        <span tabIndex={registration.queueStatus === 'RE-SCHEDULED' ? 0 : undefined}
                          title={registration.queueStatus === 'RE-SCHEDULED' ? registration.firstFailureReason || 'The first automatic registration failed.' : undefined}
                          aria-label={registration.queueStatus === 'RE-SCHEDULED' ? `RE-SCHEDULED: ${registration.firstFailureReason || 'The first automatic registration failed.'}` : 'SCHEDULED'}
                          className={`inline-flex h-6 w-28 max-w-full items-center justify-center rounded-full px-1 text-[9px] font-bold ${registration.queueStatus === 'RE-SCHEDULED' ? 'bg-amber-100 text-amber-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500' : 'bg-blue-50 text-blue-700'}`}>
                          {registration.queueStatus}
                        </span>
                      </td>}
                      {registrationTab === 'scheduled' && <td className="px-3 py-1 text-center">
                        <span className="block truncate text-[10px] text-slate-500" title={schedule}>{schedule}</span>
                      </td>}
                    </tr>;
                  })}
                  {registrationTab === 'scheduled' && !activeRegistrations.length && <tr><td colSpan={6} className="h-20 px-4 text-center align-middle text-xs text-slate-500">No eligible registrations to schedule.</td></tr>}
                  {registrationTab === 'ineligible' && !activeRegistrations.length && <tr><td colSpan={4} className="h-20 px-4 text-center align-middle text-xs text-slate-500">There are no non-eligible registrations.</td></tr>}
                </tbody>
              </table>
            </div>
            <CompactPager page={currentRegistrationPage} pages={registrationPages} onPage={setRegistrationPage}
              label={`${registrationTab === 'scheduled' ? 'Scheduled registrations' : 'Non-eligible registrations'} pagination`} />
          </div>
        </section>

        <SubmissionDetailModal submission={activeSubmission} isOpen={Boolean(activeSubmission)}
          onClose={() => setActiveSubmission(null)}
          onOpenAssignId={() => notifyError('Assign the CargoMove ID from Registration Queue.')}
          onStatusChange={() => { setActiveSubmission(null); setLocalRefresh(value => value + 1); }} />

        <section aria-label="Execution logs" className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-50/70 px-3 py-3">
            <h3 className="text-sm font-bold text-slate-900">Execution logs</h3>
            <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-2">
              <div className="relative min-w-[180px] max-w-xs flex-1 sm:flex-none">
                <Search aria-hidden="true" className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                <input type="search" aria-label="Search execution logs" placeholder="Search execution logs" value={logSearch}
                  onChange={event => { setLogSearch(event.target.value); setLogPage(1); }}
                  className="h-8 w-full rounded-lg border border-slate-200 bg-white pl-8 pr-3 text-xs text-slate-700 outline-none placeholder:text-slate-400 focus:border-blue-400 focus:ring-2 focus:ring-blue-100 sm:w-56" />
              </div>
              <select aria-label="Execution logs per page" value={logPageSize}
                onChange={event => { setLogPageSize(Number(event.target.value)); setLogPage(1); }}
                className="h-8 rounded-lg border border-slate-200 bg-white px-2 text-xs font-semibold text-slate-700 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100">
                <option value={25}>Show 25</option><option value={50}>Show 50</option><option value={100}>Show 100</option>
              </select>
            </div>
          </div>
          <div data-testid="execution-logs-viewport" className="overflow-hidden">
            <table aria-label="Auto Register in CM execution logs" style={{ tableLayout: 'fixed', width: '100%', maxWidth: '100%' }} className="w-full text-[10px] sm:text-[11px]">
              <colgroup><col style={{ width: '7%' }} /><col style={{ width: '11%' }} /><col style={{ width: '11%' }} /><col style={{ width: '13%' }} /><col style={{ width: '8%' }} /><col style={{ width: '7%' }} /><col style={{ width: '7%' }} /><col style={{ width: '6%' }} /><col style={{ width: '6%' }} /><col style={{ width: '24%' }} /></colgroup>
              <thead className="bg-slate-100 text-[9px] font-bold uppercase tracking-wide text-slate-600 sm:text-[10px]"><tr><th style={{ textAlign: 'center' }} className="break-words px-1 py-2">Execution</th><th style={{ textAlign: 'center' }} className="break-words px-1 py-2">Execution ID</th><th style={{ textAlign: 'center' }} className="break-words px-1 py-2">Registration ID</th><th style={{ textAlign: 'center' }} className="break-words px-1 py-2">Started (MYT)</th><th style={{ textAlign: 'center' }} className="break-words px-1 py-2">Status</th><th style={{ textAlign: 'center' }} className="break-words px-1 py-2">Duration</th><th style={{ textAlign: 'center' }} className="break-words px-1 py-2">Processed</th><th style={{ textAlign: 'center' }} className="break-words px-1 py-2">Success</th><th style={{ textAlign: 'center' }} className="break-words px-1 py-2">Failed</th><th style={{ textAlign: 'left' }} className="break-words px-2 py-2">Message</th></tr></thead>
              <tbody className="divide-y divide-slate-100">{pagedRuns.map(run => <tr key={run.id}>
                <td style={{ textAlign: 'center' }} className="break-words px-1 py-2 font-semibold text-slate-700">{run.executionType === 'AUTOMATIC' ? 'Automatic' : 'Manual'}</td>
                <td style={{ textAlign: 'center', overflowWrap: 'anywhere' }} className="px-1 py-2 font-mono text-[9px] text-slate-700 sm:text-[10px]">{run.executionId}</td>
                <td style={{ textAlign: 'center', overflowWrap: 'anywhere' }} className="px-1 py-2 font-mono text-[9px] text-slate-700 sm:text-[10px]">
                  {run.registrationReferences?.length
                    ? run.registrationReferences.map(reference => <span key={reference} className="block">{reference}</span>)
                    : <span>—</span>}
                </td>
                <td style={{ textAlign: 'center' }} className="break-words px-1 py-2 text-slate-600">{malaysiaDate(run.startedAt)}</td>
                <td style={{ textAlign: 'center' }} className="break-words px-1 py-2"><span className={`inline-block max-w-full break-words rounded-full px-1.5 py-1 text-[9px] font-bold sm:text-[10px] ${statusTone(run.status)}`}>{run.status}</span></td>
                <td style={{ textAlign: 'center' }} className="break-words px-1 py-2 text-slate-600">{run.durationMs == null ? '—' : `${(run.durationMs / 1000).toFixed(1)}s`}</td>
                <td style={{ textAlign: 'center' }} className="px-1 py-2">{run.processedCount}</td><td style={{ textAlign: 'center' }} className="px-1 py-2 text-emerald-700">{run.successCount}</td>
                <td style={{ textAlign: 'center' }} className="px-1 py-2 text-rose-700">{run.failedCount}</td>
                <td style={{ textAlign: 'left', whiteSpace: 'normal', overflowWrap: 'anywhere' }} className="px-2 py-2 text-slate-600" title={run.errorMessage || run.message}>
                  <span data-testid="execution-log-message" style={{ display: '-webkit-box', WebkitBoxOrient: 'vertical', WebkitLineClamp: 3, overflow: 'hidden' }}>{run.errorMessage || run.message || '—'}</span>
                </td>
              </tr>)}
              {!filteredRuns.length && <tr><td colSpan={10} className="px-4 py-8 text-center text-xs text-slate-500">{runs.length ? 'No execution logs match your search.' : 'No execution history yet.'}</td></tr>}</tbody>
            </table>
          </div>
          <CompactPager page={currentLogPage} pages={logPages} onPage={setLogPage} label="Execution logs pagination" />
        </section>
      </>}
    </div>
  );
}
