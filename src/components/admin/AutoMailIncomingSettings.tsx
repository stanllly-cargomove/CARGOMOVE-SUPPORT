import React, { useEffect, useState } from 'react';
import { Mail, Clock3 } from 'lucide-react';
import { type SettingsStatus, SettingsCard, SettingsToggle, SettingsActions, settingsInput } from './AutoMailSettingsUi';
import { knowledgeRequest } from '../../services/autoMailKnowledge';
import { AutoMailSnackbar, AutoMailSnackbarArea } from './AutoMailSnackbar';

type Settings = { enabled: boolean; scope: string; version: number; auto_reply_enabled: boolean; min_confidence: number; max_auto_replies_per_hour: number };
type Result = { storageReady: boolean; autoReplyReady?: boolean; autoReplyServerEnabled?: boolean; settings: Settings; worker: { last_seen: string } | null };
const defaults = (settings: Partial<Settings> & Pick<Settings, 'enabled' | 'scope' | 'version'>): Settings => ({ auto_reply_enabled: false, min_confidence: 0.95, max_auto_replies_per_hour: 5, ...settings });

export function AutoMailIncomingSettings({ onDirtyChange, refreshToken = 0, onStateChange }: { onDirtyChange?: (dirty: boolean) => void; refreshToken?: number; onStateChange?: (status: SettingsStatus) => void } = {}) {
  const [result, setResult] = useState<Result | null>(null);
  const [form, setForm] = useState<Settings | null>(null);
  const [busy, setBusy] = useState(true);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState('');
  const [failed, setFailed] = useState(false);
  const [notice, setNotice] = useState('');
  useEffect(() => { onDirtyChange?.(dirty); return () => onDirtyChange?.(false); }, [dirty, onDirtyChange]);
  useEffect(() => {
    const controller = new AbortController(); setBusy(true); setFailed(false); setError('');
    void knowledgeRequest<Result>('incoming-settings', undefined, controller.signal)
      .then(value => { if (!controller.signal.aborted) { setResult(value); setForm(defaults(value.settings)); setDirty(false); setNotice(''); } })
      .catch(reason => { if (!controller.signal.aborted) { setFailed(true); setError(reason.message); } })
      .finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, [refreshToken]);
  const ready = !!result?.storageReady;
  useEffect(() => { onStateChange?.({ busy, ready, error: failed }); }, [busy, ready, failed, onStateChange]);
  const change = (update: Partial<Settings>) => { setForm(current => current ? { ...current, ...update } : current); setDirty(true); setNotice(''); };
  const save = async () => {
    if (!form || busy) return;
    setBusy(true); setFailed(false); setError('');
    try {
      const value = await knowledgeRequest<{ settings: Settings }>('incoming-settings', form);
      setForm(defaults(value.settings)); setResult(current => current ? { ...current, settings: defaults(value.settings) } : current); setDirty(false);
      setNotice(value.settings.auto_reply_enabled ? 'Automatic replies are ON for eligible new incoming messages.' : 'Automatic replies are OFF. Replies require staff review and Send.');
    } catch (reason) { setFailed(true); setError(reason instanceof Error ? reason.message : 'Unable to save incoming settings.'); }
    finally { setBusy(false); }
  };
  const valid = !!form && Number.isFinite(form.min_confidence) && form.min_confidence >= 0.8 && form.min_confidence <= 1
    && Number.isInteger(form.max_auto_replies_per_hour) && form.max_auto_replies_per_hour >= 1 && form.max_auto_replies_per_hour <= 20;
  const savedMode = result?.settings.auto_reply_enabled ? 'Auto-reply on' : result?.settings.enabled ? 'Drafts only' : 'Off';
  return <SettingsCard label="Automatic incoming drafts" title="Incoming email" description="Control when AI prepares drafts and sends replies." icon={<Mail className="h-4 w-4" />} badge={result ? savedMode : undefined}>
    <AutoMailSnackbarArea>{error && <AutoMailSnackbar key={error} alert onDismiss={() => setError('')}>{error}</AutoMailSnackbar>}{notice && <AutoMailSnackbar key={notice} onDismiss={() => setNotice('')}>{notice}</AutoMailSnackbar>}</AutoMailSnackbarArea>
    {busy && !form && <p role="status" className="px-5 py-8 text-xs text-slate-500">Loading incoming email settings...</p>}
    {form && <form onSubmit={event => { event.preventDefault(); void save(); }}>
      <div className="divide-y divide-slate-100">
        {result && !result.storageReady && <p className="bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-800 sm:px-5">Incoming email needs database setup before settings can be saved. Contact your developer to complete the configuration.</p>}
        <div className="px-4 py-4 sm:px-5"><SettingsToggle label="Automatically prepare drafts for incoming emails" displayLabel="Prepare incoming drafts" description="Prepare answers for new messages to review." checked={form.enabled} disabled={busy || !result?.storageReady} onChange={enabled => change({ enabled, ...(!enabled ? { auto_reply_enabled: false } : {}) })} /></div>
        <div className="px-4 py-4 sm:px-5">
          <SettingsToggle label="Let AI send eligible replies automatically" displayLabel="Automatic replies" description="Send only supported KB answers that pass both confidence checks." checked={form.auto_reply_enabled} disabled={busy || !result?.autoReplyReady || !form.enabled || (!result.autoReplyServerEnabled && !form.auto_reply_enabled)} onChange={auto_reply_enabled => change({ auto_reply_enabled })} />
          {result && !result.autoReplyReady && <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800">Automatic replies need database setup. Ask your developer to apply the controlled auto-replies update.</p>}
          {result?.autoReplyReady && !result.autoReplyServerEnabled && <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800">Automatic sending is disabled on the server. Draft preparation remains available.</p>}
        </div>
        <div className="grid items-center gap-3 px-4 py-4 sm:grid-cols-[minmax(180px,1fr)_minmax(0,1.4fr)] sm:px-5">
          <div><label htmlFor="auto-mail-knowledge-scope" className="text-xs font-semibold text-slate-800">Knowledge scope</label><p className="mt-1 text-xs leading-5 text-slate-500">Use ALL for general answers, or choose this mailbox's port.</p></div>
          <input id="auto-mail-knowledge-scope" aria-label="Authoritative KB scope" value={form.scope} maxLength={80} required disabled={busy || !result?.storageReady} onChange={event => change({ scope: event.target.value })} className={settingsInput} />
        </div>
        <div className="grid gap-4 px-4 py-4 sm:grid-cols-2 sm:px-5">
          <label className="block text-xs font-semibold text-slate-800">Minimum confidence (%)<input aria-label="Minimum confidence (%)" type="number" min={80} max={100} step={1} required value={Number.isFinite(form.min_confidence) ? Math.round(form.min_confidence * 100) : ''} disabled={busy || !result?.autoReplyReady} onChange={event => change({ min_confidence: event.target.value === '' ? NaN : Number(event.target.value) / 100 })} className={`${settingsInput} mt-2`} /><span className="mt-1.5 block text-[11px] font-normal leading-5 text-slate-500">80-100%. Start with 95% for stricter matching.</span></label>
          <label className="block text-xs font-semibold text-slate-800">Maximum automatic replies per hour<input aria-label="Maximum automatic replies per hour" type="number" min={1} max={20} step={1} required value={Number.isFinite(form.max_auto_replies_per_hour) ? form.max_auto_replies_per_hour : ''} disabled={busy || !result?.autoReplyReady} onChange={event => change({ max_auto_replies_per_hour: event.target.value === '' ? NaN : Number(event.target.value) })} className={`${settingsInput} mt-2`} /><span className="mt-1.5 block text-[11px] font-normal leading-5 text-slate-500">1-20 replies. Start small and review the results.</span></label>
        </div>
        <details className="px-4 py-4 sm:px-5"><summary className="cursor-pointer text-xs font-semibold text-slate-700">How automatic replies are checked</summary><div className="mt-3 space-y-2 text-xs leading-5 text-slate-500"><p>Confidence is a model estimate, not measured accuracy. Classification and a separate answer check must both meet your threshold. Attachments, automated senders, unknown issues and answers needing human checks stay for review.</p><p>One automatic reply per conversation in 24 hours. Only mail received after you turn sending on can qualify. Turning it off stops new send claims; a reply already sending may finish. Failed or uncertain deliveries are never automatically retried.</p><p>Review outcomes in Auto Mail / Drafts / By AI tools. Incoming drafting processes up to 20 messages per hour.</p></div></details>
        <div className="flex items-center gap-2 px-4 py-3 text-[11px] text-slate-500 sm:px-5"><Clock3 aria-hidden="true" className="h-3.5 w-3.5 shrink-0" /><span>Last worker check: {result?.worker?.last_seen ? new Date(result.worker.last_seen).toLocaleString() : 'Not active yet'}</span></div>
      </div>
      <SettingsActions dirty={dirty} busy={busy} saveDisabled={busy || !dirty || !result?.storageReady || !form.scope.trim() || !valid} saveLabel="Save incoming draft settings" />
    </form>}
  </SettingsCard>;
}
