import React, { useEffect, useRef, useState } from 'react';
import { Clock, Loader2, Play, Plus, X } from 'lucide-react';
import { notifyError, notifySuccess } from '../common/notifications';
import type { SavedScheduler } from '../../types/scheduler';

type Result = { status: string; message: string; timestamp: string; lastRunVerification?: { status: 'ADVANCED' | 'UNCHANGED' | 'UNAVAILABLE'; before: string | null; after: string | null; observedAt: string } };

export function CargoMoveScheduler() {
  const [schedulers, setSchedulers] = useState<SavedScheduler[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [draft, setDraft] = useState({ displayName: '', url: '', description: '' });
  const [runningId, setRunningId] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, Result>>({});
  const pending = useRef(false);
  const savePending = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setLoadError('');
    void (async () => {
      try {
        const response = await fetch('/api/dev-tools/schedulers', { credentials: 'same-origin', signal: controller.signal });
        const data = await response.json().catch(() => null);
        if (!response.ok || !Array.isArray(data?.schedulers)) throw new Error(data?.error || 'Unable to load scheduler gallery. Check that the API is running and the gallery migration is applied.');
        if (!controller.signal.aborted) setSchedulers(data.schedulers);
      } catch (error) {
        if (!controller.signal.aborted) setLoadError(error instanceof Error ? error.message : 'Unable to load scheduler gallery.');
      } finally { if (!controller.signal.aborted) setLoading(false); }
    })();
    return () => controller.abort();
  }, [refresh]);

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (savePending.current) return;
    savePending.current = true;
    setSaving(true);
    setFormError('');
    try {
      const response = await fetch('/api/dev-tools/schedulers', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'X-CargoMove-Confirm': 'manage-schedulers' },
        body: JSON.stringify(draft),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.scheduler?.id) throw new Error(data?.error || 'Unable to save the scheduler. Check the API and gallery migration.');
      setSchedulers(previous => [...previous, data.scheduler]);
      setDraft({ displayName: '', url: '', description: '' });
      setShowForm(false);
      notifySuccess('Scheduler saved to the gallery.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to save the scheduler.';
      setFormError(message);
      notifyError(message);
    } finally { setSaving(false); savePending.current = false; }
  };

  const run = async (scheduler: SavedScheduler) => {
    if (pending.current || !scheduler.enabled || !window.confirm(`Trigger ${scheduler.displayName} (${scheduler.workerName}) on the production CargoMove system?`)) return;
    pending.current = true;
    setRunningId(scheduler.id);
    setResults(previous => { const next = { ...previous }; delete next[scheduler.id]; return next; });
    try {
      const response = await fetch('/api/dev-tools/run-scheduler', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'X-CargoMove-Confirm': 'run-scheduler' },
        body: JSON.stringify({ schedulerId: scheduler.id }),
      });
      let data = await response.json().catch(() => null);
      if (!data?.status || !data?.message) {
        const local = ['localhost', '127.0.0.1'].includes(window.location.hostname);
        const detail = response.status === 404 ? 'Scheduler API was not found. Deploy the updated backend route.'
          : local && response.status >= 500 ? 'Local scheduler API is unavailable. Start npm run dev:api and check its terminal output.'
          : response.status === 504 ? 'The scheduler API timed out.' : 'The scheduler API did not return a valid result. Check the Vercel function logs.';
        data = { status: 'unknown', timestamp: new Date().toISOString(), message: `${detail} (HTTP ${response.status}). Check CargoMove Scheduled Tasks before attempting another run.` };
      }
      setResults(previous => ({ ...previous, [scheduler.id]: data }));
      if (response.ok && data.status === 'trigger_requested') notifySuccess(data.message);
      else notifyError(data.message);
    } catch {
      const message = 'Unable to confirm the result. Check CargoMove Scheduled Tasks before attempting another run.';
      setResults(previous => ({ ...previous, [scheduler.id]: { status: 'unknown', message, timestamp: new Date().toISOString() } }));
      notifyError(message);
    } finally { pending.current = false; setRunningId(null); }
  };

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 gap-3">
          <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-700"><Clock className="h-4 w-4" /></span>
          <div>
            <h3 className="text-sm font-bold text-slate-900">CargoMove Scheduler</h3>
            <p className="mt-1 text-xs leading-5 text-slate-600">Save CargoMove schedulers and manually send a run request from this gallery.</p>
            <p className="mt-1 text-xs text-slate-500">Target system: CargoMove · Execution mode: Manual</p>
          </div>
        </div>
        <button type="button" disabled={loading || Boolean(loadError)} onClick={() => { setShowForm(true); setFormError(''); }} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50"><Plus className="h-4 w-4" />Add Scheduler</button>
      </div>

      {showForm && <form onSubmit={event => void save(event)} className="mt-5 space-y-3 rounded-xl border border-blue-100 bg-blue-50/40 p-4">
        <div className="flex items-center justify-between gap-2"><h4 className="text-sm font-bold text-slate-900">Add Scheduler</h4><button type="button" aria-label="Close scheduler form" disabled={saving} onClick={() => setShowForm(false)} className="rounded p-1 text-slate-500 hover:bg-slate-100"><X className="h-4 w-4" /></button></div>
        <label className="block text-xs font-semibold text-slate-700">Title<input required maxLength={100} value={draft.displayName} onChange={event => setDraft({ ...draft, displayName: event.target.value })} disabled={saving} className="mt-1 block w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-normal" placeholder="Northport Containers" /></label>
        <label className="block text-xs font-semibold text-slate-700">Scheduler link<input type="url" required maxLength={1000} value={draft.url} onChange={event => setDraft({ ...draft, url: event.target.value })} disabled={saving} className="mt-1 block w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-normal" placeholder="https://www.cargomove.my/administration/run_scheduled_task?id=...&name=..." /></label>
        <p className="text-xs leading-5 text-slate-500">Paste the Run now link from CargoMove Scheduled Tasks. Saving a link does not run it.</p>
        <label className="block text-xs font-semibold text-slate-700">Description (optional)<textarea maxLength={500} rows={2} value={draft.description} onChange={event => setDraft({ ...draft, description: event.target.value })} disabled={saving} className="mt-1 block w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-normal" /></label>
        {formError && <p role="alert" className="text-xs text-rose-700">{formError}</p>}
        <div className="flex gap-2"><button type="submit" disabled={saving} className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-xs font-bold text-white hover:bg-blue-700 disabled:opacity-50">{saving && <Loader2 className="h-4 w-4 animate-spin" />}{saving ? 'Saving...' : 'Save Scheduler'}</button><button type="button" disabled={saving} onClick={() => setShowForm(false)} className="rounded-lg px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100">Cancel</button></div>
      </form>}

      {loading && <p role="status" className="mt-5 flex items-center gap-2 text-xs text-slate-500"><Loader2 className="h-4 w-4 animate-spin" />Loading schedulers...</p>}
      {loadError && <div role="alert" className="mt-5 text-xs text-rose-700"><p>{loadError}</p><button type="button" onClick={() => setRefresh(value => value + 1)} className="mt-2 font-bold underline">Reload gallery</button></div>}
      {!loading && !loadError && schedulers.length === 0 && <p className="mt-5 text-xs text-slate-500">No saved schedulers. Add a CargoMove scheduler link to get started.</p>}
      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        {schedulers.map(scheduler => {
          const running = runningId === scheduler.id;
          const result = results[scheduler.id];
          return <article key={scheduler.id} aria-labelledby={`scheduler-${scheduler.id}`} className="min-w-0 rounded-xl border border-slate-200 p-4">
            <h4 id={`scheduler-${scheduler.id}`} className="break-words text-sm font-bold text-slate-900">{scheduler.displayName}</h4>
            <p className="mt-1 break-all font-mono text-xs text-slate-500">{scheduler.workerName}</p>
            {scheduler.description && <p className="mt-2 break-words text-xs leading-5 text-slate-600">{scheduler.description}</p>}
            <details className="mt-3 text-xs text-slate-500"><summary className="cursor-pointer">Scheduler link</summary><p className="mt-2 break-all">{scheduler.url}</p></details>
            <div aria-live="polite" className="mt-4 space-y-2 text-xs">
              <p className="font-semibold text-slate-700">Status: {!scheduler.enabled ? 'Disabled' : running ? 'Running' : result?.status === 'trigger_requested' ? 'Request Sent' : result?.status === 'unknown' ? 'Unknown - check CargoMove' : result ? 'Failed' : 'Ready'}</p>
              {result && <><p className={result.status === 'trigger_requested' ? 'text-emerald-700' : 'text-rose-700'}>{result.message}</p><p className="text-slate-500">Latest request: {new Date(result.timestamp).toLocaleString()}</p></>}
              {result?.lastRunVerification && <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-slate-600"><p className="font-semibold text-slate-700">CargoMove Last run</p><p className="mt-1">Before: {result.lastRunVerification.before || 'Unavailable'}</p><p>After: {result.lastRunVerification.after || 'Unavailable'}</p><p className="mt-1 text-[11px]">Observed {new Date(result.lastRunVerification.observedAt).toLocaleString('en-GB',{timeZone:'Asia/Kuala_Lumpur'})} MYT. This does not verify individual container imports.</p></div>}
            </div>
            <button type="button" disabled={Boolean(runningId) || !scheduler.enabled} onClick={() => void run(scheduler)} className="mt-4 inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-xs font-bold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50">
              {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              {running ? 'Running Scheduler...' : result?.status === 'trigger_requested' ? 'Scheduler request sent' : 'Run Scheduler'}
            </button>
          </article>;
        })}
      </div>
    </section>
  );
}
