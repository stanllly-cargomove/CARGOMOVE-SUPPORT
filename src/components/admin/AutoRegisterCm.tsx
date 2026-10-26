import React, { useEffect, useRef, useState } from 'react';
import { Activity, Bot, Check, CheckCircle2, ChevronDown, Clock3, FileText, Loader2, Play, Search, XCircle } from 'lucide-react';
import { notifyError, notifySuccess } from '../common/notifications';
import type { RegistrationSubmission } from '../../types';
import { SubmissionDetailModal } from './SubmissionDetailModal';
import { autoRegisterSchedule } from '../../utils/autoRegisterSchedule';
import { subscribeToStorage } from '../../services/storage';

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
  lastAutomaticRunAt?: string | null;
  cronTrigger?: { isEnabled: boolean; lastTickAt: string | null; status: string; errorCode: string | null } | null;
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

const executionStatusOptions: Array<{ value: SchedulerRun['status']; label: string; description: string; row: string; selected: string; icon: string; check: string }> = [
  { value: 'FAILED', label: 'Failed', description: 'One or more registrations failed.', row: 'bg-rose-50/60 hover:bg-rose-100/70', selected: 'bg-rose-100 ring-1 ring-inset ring-rose-200', icon: 'bg-rose-100 text-rose-700', check: 'text-rose-600' },
  { value: 'SUCCESS', label: 'Success', description: 'Completed without registration failures.', row: 'bg-emerald-50/60 hover:bg-emerald-100/70', selected: 'bg-emerald-100 ring-1 ring-inset ring-emerald-200', icon: 'bg-emerald-100 text-emerald-700', check: 'text-emerald-600' },
  { value: 'RUNNING', label: 'Running', description: 'Currently processing registrations.', row: 'bg-blue-50/60 hover:bg-blue-100/70', selected: 'bg-blue-100 ring-1 ring-inset ring-blue-200', icon: 'bg-blue-100 text-blue-700', check: 'text-blue-600' },
  { value: 'SKIPPED', label: 'Skipped', description: 'Ended without processing registrations.', row: 'bg-amber-50/60 hover:bg-amber-100/70', selected: 'bg-amber-100 ring-1 ring-inset ring-amber-200', icon: 'bg-amber-100 text-amber-700', check: 'text-amber-600' },
];

function ExecutionStatusFilter({ value, onChange }: { value: SchedulerRun['status'][]; onChange: (value: SchedulerRun['status'][]) => void }) {
  const menuRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const ignoreLayoutScrollUntil = useRef(0);
  const [open, setOpen] = useState(false);
  const selectedLabel = executionStatusOptions.filter(option => value.includes(option.value)).map(option => option.label).join(' + ') || 'No status';
  useEffect(() => {
    if (!open) return;
    const close = () => menuRef.current?.hidePopover();
    const closeOnScroll = () => { if (performance.now() >= ignoreLayoutScrollUntil.current) close(); };
    window.addEventListener('scroll', closeOnScroll, true);
    window.addEventListener('wheel', close, { passive: true });
    window.addEventListener('touchmove', close, { passive: true });
    return () => {
      window.removeEventListener('scroll', closeOnScroll, true);
      window.removeEventListener('wheel', close);
      window.removeEventListener('touchmove', close);
    };
  }, [open]);
  return <>
    <button ref={buttonRef} type="button" aria-label={`Filter execution logs by status: ${selectedLabel}`} aria-haspopup="dialog" aria-expanded={open}
      className="inline-flex h-8 max-w-full items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-semibold text-slate-700 shadow-sm outline-none hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-blue-500"
      onClick={() => {
        const menu = menuRef.current, button = buttonRef.current;
        if (!menu || !button) return;
        if (menu.matches(':popover-open')) { menu.hidePopover(); return; }
        const rect = button.getBoundingClientRect();
        menu.style.left = `${Math.max(8, Math.min(rect.right - 320, window.innerWidth - 328))}px`;
        menu.style.top = `${Math.max(8, rect.bottom + 260 > window.innerHeight ? rect.top - 260 : rect.bottom + 6)}px`;
        menu.showPopover();
        menu.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus();
      }}>
      <span className="truncate">Status</span>
      <ChevronDown className="h-3.5 w-3.5 shrink-0 text-slate-500" aria-hidden="true" />
    </button>
    <div ref={menuRef} popover="auto" role="dialog" aria-label="Execution status filter" onToggle={() => setOpen(menuRef.current?.matches(':popover-open') ?? false)}
      style={{ position: 'fixed', margin: 0 }} className="w-80 max-w-[calc(100vw-1rem)] rounded-xl border border-slate-200 bg-white p-2 text-xs text-slate-700 shadow-xl">
      <p className="px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Filter by status</p>
      <div role="group" aria-label="Execution statuses">{executionStatusOptions.map(option => {
        const selected = value.includes(option.value);
        return <button key={option.value} type="button" role="checkbox" aria-checked={selected}
          className={`mb-1 flex w-full items-start gap-2.5 rounded-lg px-2.5 py-1.5 text-left outline-none transition-colors last:mb-0 focus-visible:ring-2 focus-visible:ring-blue-500 ${selected ? option.selected : option.row}`}
          onClick={() => {
            ignoreLayoutScrollUntil.current = performance.now() + 150;
            onChange(selected ? value.filter(status => status !== option.value) : [...value, option.value]);
          }}>
          <span className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md ${option.icon}`}><span className="h-2 w-2 rounded-full bg-current" aria-hidden="true" /></span>
          <span className="min-w-0 flex-1"><span className="block font-semibold leading-4 text-slate-900">{option.label}</span><span className="mt-0.5 block text-[11px] leading-[15px] text-slate-500">{option.description}</span></span>
          {selected && <Check className={`mt-0.5 h-4 w-4 shrink-0 ${option.check}`} aria-hidden="true" />}
        </button>;
      })}</div>
    </div>
  </>;
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
  if (!response.ok) throw Object.assign(new Error(data?.error || data?.message || fallback), { status: response.status });
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

export function AutoRegisterCmPage({ cacheScope = 'default', refreshVersion = 0, pollEnabled = true }: {
  onBack: () => void;
  cacheScope?: string;
  refreshVersion?: number;
  pollEnabled?: boolean;
}) {
  const cached = autoRegisterCache.get(cacheScope)?.snapshot;
  const [scheduler, setScheduler] = useState<AutoScheduler | null>(cached?.scheduler ?? null);
  const [runs, setRuns] = useState<SchedulerRun[]>(cached?.runs ?? []);
  const [registrations, setRegistrations] = useState<Registration[]>(cached?.registrations ?? []);
  const [history, setHistory] = useState<QueueHistory[]>(cached?.history ?? []);
  const [registrationTab, setRegistrationTab] = useState<'scheduled' | 'ineligible'>('scheduled');
  const [loading, setLoading] = useState(!cached);
  const [error, setError] = useState('');
  const [syncError, setSyncError] = useState(false);
  const mutationEpoch = useRef(0);
  const [localRefresh, setLocalRefresh] = useState(0);
  const [running, setRunning] = useState(false);
  const [registrationPage, setRegistrationPage] = useState(1);
  const [activeSubmission, setActiveSubmission] = useState<RegistrationSubmission | null>(null);
  const [logSearch, setLogSearch] = useState('');
  const [logStatuses, setLogStatuses] = useState<SchedulerRun['status'][]>(['FAILED', 'SUCCESS']);
  const [logPageSize, setLogPageSize] = useState(25);
  const [logPage, setLogPage] = useState(1);

  useEffect(() => {
    const cachedEntry = autoRegisterCache.get(cacheScope);
    let hasSnapshot = Boolean(cachedEntry?.snapshot);
    if (cachedEntry) {
      setScheduler(cachedEntry.snapshot.scheduler);
      setRuns(cachedEntry.snapshot.runs);
      setRegistrations(cachedEntry.snapshot.registrations);
      setHistory(cachedEntry.snapshot.history);
      setLoading(false);
      setError('');
    } else {
      setScheduler(null); setRuns([]); setRegistrations([]); setHistory([]);
      setLoading(true); setError('');
    }
    if (!pollEnabled || running) return;

    let stopped = false, inFlight = false, queued = false, queuedDiscovery = false, failures = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let activeController: AbortController | null = null;
    const pageVisible = () => document.visibilityState !== 'hidden';
    const refresh = async (discover = false) => {
      if (stopped || !pageVisible()) return;
      if (inFlight) { queued = true; queuedDiscovery ||= discover; return; }
      if (timer) clearTimeout(timer);
      inFlight = true;
      const epoch = mutationEpoch.current;
      const controller = new AbortController();
      activeController = controller;
      try {
        const scheduleNew = async () => {
          const response = await fetch('/api/scheduler/auto-register-cm-queue', {
            method: 'POST',
            credentials: 'same-origin',
            signal: controller.signal,
            headers: { 'Content-Type': 'application/json', 'X-CargoMove-Confirm': 'auto-schedule-auto-register-cm' },
            body: '{}',
          });
          const data = await readJson(response, 'Unable to automatically schedule eligible registrations.');
          if (typeof data?.scheduled !== 'number') throw new Error('The queue did not confirm automatic scheduling.');
          return data.scheduled as number;
        };
        const loadQueue = async () => {
          const response = await fetch('/api/scheduler/auto-register-cm-queue', { credentials: 'same-origin', signal: controller.signal });
          const data = await readJson(response, 'Unable to load the scheduled registration queue.');
          if (!Array.isArray(data?.registrations) || !Array.isArray(data?.history)) throw new Error('Auto Register returned incomplete registration data.');
          return data;
        };
        const [schedulerData, queueData] = await Promise.all([
          fetch('/api/scheduler/auto-register-cm', { credentials: 'same-origin', signal: controller.signal })
            .then(response => readJson(response, 'Unable to load Auto Register in CM.')),
          (async () => {
            if (discover) await scheduleNew();
            let data = await loadQueue();
            // Ordinary polls only read. Queue discovery is needed when new
            // eligible assets arrive, not on every background interval.
            if (!discover && data.registrations.some((item: Registration) => item.eligible && !item.scheduled
              && item.queueStatus === 'SCHEDULED' && item.submission.status === 'PENDING'
              && item.submission.cargomove_upload?.state !== 'SUCCESS')) {
              if (await scheduleNew()) data = await loadQueue();
            }
            return data;
          })(),
        ]);
        if (!schedulerData?.scheduler || !Array.isArray(schedulerData.runs)
          || !Array.isArray(queueData.registrations) || !Array.isArray(queueData.history)) {
          throw new Error('Auto Register returned incomplete scheduler or registration data.');
        }
        if (!stopped && !controller.signal.aborted) {
          // A toggle, manual run or storage change supersedes an older read.
          if (epoch !== mutationEpoch.current) { queued = true; return; }
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
          hasSnapshot = true;
          failures = 0;
          setError(''); setSyncError(false);
        }
      } catch (reason) {
        controller.abort(); // Cancel the sibling request before retrying.
        if (!stopped) {
          failures++;
          const message = reason instanceof Error ? reason.message : 'Unable to load Auto Register in CM.';
          if ([401, 403].includes((reason as { status?: number })?.status || 0)) {
            autoRegisterCache.delete(cacheScope);
            hasSnapshot = false;
            setScheduler(null); setRuns([]); setRegistrations([]); setHistory([]);
          }
          if (!hasSnapshot) setError(message);
          else { setSyncError(true); if (discover) notifyError(message); }
        }
      } finally {
        inFlight = false; activeController = null;
        if (!stopped) {
          setLoading(false);
          if (queued) {
            const discoverNext = queuedDiscovery;
            queued = false; queuedDiscovery = false;
            timer = setTimeout(() => { void refresh(discoverNext); }, 200);
          } else if (pageVisible()) {
            timer = setTimeout(() => { void refresh(); }, Math.min(60_000, 15_000 * 2 ** failures));
          }
        }
      }
    };
    const resume = () => { void refresh(); };
    const visibility = () => { if (!pageVisible()) { if (timer) clearTimeout(timer); } else resume(); };
    const unsubscribe = subscribeToStorage(() => { mutationEpoch.current++; resume(); });
    window.addEventListener('focus', resume);
    window.addEventListener('online', resume);
    document.addEventListener('visibilitychange', visibility);
    void refresh(!cachedEntry || cachedEntry.refreshVersion !== refreshVersion || localRefresh > 0);
    return () => {
      stopped = true; activeController?.abort(); if (timer) clearTimeout(timer);
      unsubscribe();
      window.removeEventListener('focus', resume);
      window.removeEventListener('online', resume);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [cacheScope, localRefresh, refreshVersion, pollEnabled, running]);

  const ineligible = registrations.filter(registration => !registration.eligible);
  const scheduleTiming = autoRegisterSchedule(Date.now(), scheduler?.lastAutomaticRunAt);
  const scheduledRegistrations = registrations.filter(registration => registration.eligible && registration.queueStatus !== 'FAILED');
  const queuedRegistrationCount = scheduledRegistrations.filter(registration => registration.scheduled).length;
  const activeRegistrations = registrationTab === 'scheduled' ? scheduledRegistrations : ineligible;
  const registrationPageSize = 5;
  const registrationPages = Math.max(1, Math.ceil(activeRegistrations.length / registrationPageSize));
  const currentRegistrationPage = Math.min(registrationPage, registrationPages);
  const pagedRegistrations = activeRegistrations.slice((currentRegistrationPage - 1) * registrationPageSize, currentRegistrationPage * registrationPageSize);
  const normalizedLogSearch = logSearch.trim().toLowerCase();
  const filteredRuns = runs.filter(run => {
    if (!logStatuses.includes(run.status)) return false;
    if (!normalizedLogSearch) return true;
    const registrationReferences = (run.registrationReferences || []).join(' ');
    return [run.executionType, run.executionId, run.status, malaysiaDate(run.startedAt), run.message, run.errorMessage || '',
      run.processedCount, run.successCount, run.failedCount, registrationReferences]
      .some(value => String(value).toLowerCase().includes(normalizedLogSearch));
  });
  const logPages = Math.max(1, Math.ceil(filteredRuns.length / logPageSize));
  const currentLogPage = Math.min(logPage, logPages);
  const pagedRuns = filteredRuns.slice((currentLogPage - 1) * logPageSize, currentLogPage * logPageSize);
  const latestRun = runs[0] || null;
  const successfulRegistrations = runs.reduce((total, run) => total + run.successCount, 0);
  const failedRegistrations = runs.reduce((total, run) => total + run.failedCount, 0);
  const activeExecutions = runs.filter(run => run.status === 'RUNNING').length;

  const runNow = async () => {
    if (running || !queuedRegistrationCount || !window.confirm(`Run ${queuedRegistrationCount} scheduled registration${queuedRegistrationCount === 1 ? '' : 's'} in CargoMove now${scheduler?.isEnabled ? '' : ' while automatic scheduling is OFF'}?`)) return;
    mutationEpoch.current++;
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
    } catch (reason) {
      notifyError(reason instanceof Error ? reason.message : 'Auto Register in CM failed.');
    } finally {
      setRunning(false);
      setLocalRefresh(value => value + 1);
    }
  };

  return (
    <div className="w-full space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-slate-900">Auto Register in CM</h2>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-slate-500">Automatically register eligible data in CM, manage scheduling, and track every result.</p>
        </div>
        {scheduler && <div className={`inline-flex items-center gap-2 rounded-full px-3 py-2 text-xs font-bold ${scheduler.isEnabled ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>
          <span className={`h-2 w-2 rounded-full ${scheduler.isEnabled ? 'bg-emerald-500' : 'bg-slate-400'}`} aria-hidden="true" />
          {scheduler.isEnabled ? 'Enabled' : 'Disabled'}
        </div>}
      </div>

      {error && <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
        <p>{error}</p><button type="button" onClick={() => setLocalRefresh(value => value + 1)} className="mt-2 font-semibold underline">Try again</button>
      </div>}
      {loading && <AutoRegisterCmSkeleton />}
      {syncError && scheduler && <div role="status" className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">Showing saved data. Live updates are temporarily unavailable and will retry automatically.</div>}

      {!loading && !error && scheduler && <>
        <section aria-label="Auto Register schedule overview" className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm sm:p-4">
          <div className="grid gap-3 xl:grid-cols-[minmax(320px,0.95fr)_minmax(0,1.55fr)]">
            <div className="flex min-h-[230px] flex-col rounded-xl border border-emerald-100 bg-gradient-to-br from-emerald-50 via-white to-cyan-50 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-3">
                  <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-600 text-white shadow-sm"><Bot className="h-5 w-5" aria-hidden="true" /></span>
                  <div className="min-w-0"><h3 className="text-sm font-bold text-slate-900">Automatic scheduling</h3><p className="mt-0.5 text-[11px] leading-4 text-slate-600">{scheduler.isEnabled ? 'Eligible registrations will run automatically.' : 'Queued registrations wait until scheduling is enabled.'}</p></div>
                </div>
                <AutoRegisterCmToggle value={scheduler.isEnabled} cacheScope={cacheScope} onChanged={isEnabled => {
                  mutationEpoch.current++;
                  setScheduler(current => {
                    if (!current) return current;
                    const next = { ...current, isEnabled };
                    const entry = autoRegisterCache.get(cacheScope);
                    if (entry) autoRegisterCache.set(cacheScope, { ...entry, snapshot: { ...entry.snapshot, scheduler: next } });
                    return next;
                  });
                  setLocalRefresh(value => value + 1);
                }} />
              </div>
              <div data-testid="next-trigger-card" className="mt-4 rounded-lg border border-slate-200 bg-white/90 px-3 py-2.5">
                <span className="block text-[10px] font-bold uppercase tracking-wide text-slate-500">Next planned trigger</span>
                <strong className="mt-1 block truncate text-xs text-slate-900">{scheduler.isEnabled ? malaysiaDate(scheduleTiming.nextSlot) : 'Not scheduled'}</strong>
                <span className="mt-1 block text-[10px] leading-4 text-slate-500">Estimate only; execution is confirmed in the logs.</span>
              </div>
              <div data-testid="schedule-frequency-card" className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white/90 px-3 py-2.5">
                <div className="min-w-0"><span className="block text-[10px] font-bold uppercase tracking-wide text-slate-500">Run frequency</span><span className="mt-1 flex items-center gap-2 text-xs font-semibold text-slate-800"><Clock3 className="h-4 w-4 text-slate-500" aria-hidden="true" />{scheduler.schedule}</span></div>
                <button type="button" onClick={() => void runNow()} disabled={running || loading || !queuedRegistrationCount}
                  title={queuedRegistrationCount ? 'Run scheduled registrations now' : 'There are no scheduled registrations to run'}
                  className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-lg bg-blue-600 px-5 py-2 text-xs font-bold text-white shadow-sm hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50">
                  {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}{running ? 'Running…' : 'Run Now'}
                </button>
              </div>
            </div>

            <div className="flex min-w-0 flex-col gap-3">
              <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
                <div data-testid="overview-eligible-metric" className="grid grid-cols-[auto_minmax(0,1fr)_auto] grid-rows-2 items-center gap-x-2 rounded-xl border border-blue-100 bg-blue-50/70 p-3"><span className="row-span-2 inline-flex h-8 w-8 items-center justify-center rounded-lg bg-blue-100 text-blue-600"><FileText className="h-4 w-4" aria-hidden="true" /></span><span className="min-w-0 truncate text-[10px] font-semibold text-slate-600">Eligible now</span><strong className="col-start-3 row-span-2 row-start-1 text-xl leading-none text-slate-900">{scheduledRegistrations.length}</strong><span className="col-start-2 min-w-0 truncate text-[10px] text-slate-500">registration{scheduledRegistrations.length === 1 ? '' : 's'}</span></div>
                <div data-testid="overview-success-metric" className="grid grid-cols-[auto_minmax(0,1fr)_auto] grid-rows-2 items-center gap-x-2 rounded-xl border border-emerald-100 bg-emerald-50/70 p-3"><span className="row-span-2 inline-flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-100 text-emerald-600"><CheckCircle2 className="h-4 w-4" aria-hidden="true" /></span><span className="min-w-0 truncate text-[10px] font-semibold text-slate-600">Success</span><strong className="col-start-3 row-span-2 row-start-1 text-xl leading-none text-emerald-700">{successfulRegistrations}</strong><span className="col-start-2 min-w-0 truncate text-[10px] text-slate-500">completed</span></div>
                <div data-testid="overview-failed-metric" className="grid grid-cols-[auto_minmax(0,1fr)_auto] grid-rows-2 items-center gap-x-2 rounded-xl border border-rose-100 bg-rose-50/70 p-3"><span className="row-span-2 inline-flex h-8 w-8 items-center justify-center rounded-lg bg-rose-100 text-rose-600"><XCircle className="h-4 w-4" aria-hidden="true" /></span><span className="min-w-0 truncate text-[10px] font-semibold text-slate-600">Failed</span><strong className="col-start-3 row-span-2 row-start-1 text-xl leading-none text-rose-700">{failedRegistrations}</strong><span className="col-start-2 min-w-0 truncate text-[10px] text-slate-500">registrations</span></div>
                <div data-testid="overview-processing-metric" className="grid grid-cols-[auto_minmax(0,1fr)_auto] grid-rows-2 items-center gap-x-2 rounded-xl border border-amber-100 bg-amber-50/70 p-3"><span className="row-span-2 inline-flex h-8 w-8 items-center justify-center rounded-lg bg-amber-100 text-amber-600"><Activity className="h-4 w-4" aria-hidden="true" /></span><span className="min-w-0 truncate text-[10px] font-semibold text-slate-600">Processing</span><strong className="col-start-3 row-span-2 row-start-1 text-xl leading-none text-amber-700">{activeExecutions}</strong><span className="col-start-2 min-w-0 truncate text-[10px] text-slate-500">active execution{activeExecutions === 1 ? '' : 's'}</span></div>
              </div>
              <div data-testid="last-execution-row" className="grid flex-1 grid-cols-2 gap-2 rounded-xl border border-slate-200 bg-white p-3 shadow-sm sm:grid-cols-3 xl:grid-cols-[1.05fr_1.65fr_0.8fr_0.75fr_0.75fr_0.75fr] xl:gap-0 xl:p-4">
                {latestRun ? <>
                  <div data-testid="last-execution-status-section" className="flex h-full min-h-[72px] min-w-0 flex-col items-center justify-center px-2 py-1 text-center xl:px-3">
                    <span className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Last execution</span>
                    <span data-testid="last-execution-status" className={`mt-2 inline-flex h-7 w-28 shrink-0 items-center justify-center rounded-full px-3 text-[10px] font-bold ${statusTone(latestRun.status)}`}>{latestRun.status}</span>
                  </div>
                  <div className="flex h-full min-h-[72px] min-w-0 flex-col justify-center px-2 py-1 xl:border-l xl:border-slate-200 xl:px-5">
                    <span className="block text-[10px] font-bold uppercase tracking-wide text-slate-500">Last run</span>
                    <strong className="mt-2 block truncate text-sm font-medium text-slate-900">{malaysiaDate(latestRun.startedAt)}</strong>
                  </div>
                  <div data-testid="last-execution-duration-section" className="flex h-full min-h-[72px] min-w-0 flex-col items-center justify-center px-2 py-1 text-center xl:border-l xl:border-slate-200 xl:px-5">
                    <span className="block text-[10px] font-bold uppercase tracking-wide text-slate-500">Duration</span>
                    <strong className="mt-2 block text-lg font-medium leading-none text-slate-900">{latestRun.durationMs == null ? '—' : `${(latestRun.durationMs / 1000).toFixed(1)}s`}</strong>
                  </div>
                  <div data-testid="last-execution-success" className="flex h-full min-h-[72px] min-w-0 flex-col items-center justify-center rounded-xl border border-emerald-100 bg-gradient-to-br from-emerald-50 to-emerald-100/60 px-2 py-2 text-center xl:mx-2">
                    <span className="text-[10px] font-bold uppercase tracking-wide text-emerald-700">Success</span><strong className="mt-2 text-2xl leading-none text-emerald-600">{latestRun.successCount}</strong>
                  </div>
                  <div data-testid="last-execution-failed" className="flex h-full min-h-[72px] min-w-0 flex-col items-center justify-center rounded-xl border border-rose-100 bg-gradient-to-br from-rose-50 to-rose-100/60 px-2 py-2 text-center xl:mx-2">
                    <span className="text-[10px] font-bold uppercase tracking-wide text-rose-700">Failed</span><strong className="mt-2 text-2xl leading-none text-rose-600">{latestRun.failedCount}</strong>
                  </div>
                  <div data-testid="last-execution-total" className="flex h-full min-h-[72px] min-w-0 flex-col items-center justify-center rounded-xl border border-blue-100 bg-gradient-to-br from-blue-50 to-blue-100/60 px-2 py-2 text-center xl:ml-2">
                    <span className="text-[10px] font-bold uppercase tracking-wide text-blue-700">Total</span><strong className="mt-2 text-2xl leading-none text-blue-600">{latestRun.processedCount}</strong>
                  </div>
                </> : <div className="col-span-full px-2 py-4"><span className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Last execution</span><p className="mt-2 text-xs text-slate-500">No execution history yet.</p></div>}
              </div>
            </div>
          </div>
          {scheduler.isEnabled && scheduleTiming.overdue && <div role="status" className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">Automatic trigger overdue. No automatic execution was recorded for the latest expected slot. {scheduler.cronTrigger?.isEnabled ? 'Check the Supabase Cron delivery job.' : 'Check GitHub Actions delivery.'}</div>}
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
            <div data-testid="registration-table-viewport" className="overflow-hidden" style={{ minHeight: 214 }}>
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
              <ExecutionStatusFilter value={logStatuses} onChange={statuses => { setLogStatuses(statuses); setLogPage(1); }} />
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
