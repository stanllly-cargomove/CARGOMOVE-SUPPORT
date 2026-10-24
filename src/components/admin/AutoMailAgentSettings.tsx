import React, { useEffect, useState } from 'react';
import { Sparkles, Plus } from 'lucide-react';
import { knowledgeRequest } from '../../services/autoMailKnowledge';
import { type SettingsStatus, SettingsCard, SettingsToggle, SettingsActions, settingsInput, settingsSecondary } from './AutoMailSettingsUi';
import { AutoMailSnackbar, AutoMailSnackbarArea } from './AutoMailSnackbar';

type Settings = { enabled: boolean; model: string; enabled_models: string[]; version: number };
type Result = { settings: Settings; models: string[]; storageReady: boolean; serverEnabled: boolean; keyConfigured: boolean };

export function AutoMailAgentSettings({ onDirtyChange, refreshToken = 0, onStateChange }: { onDirtyChange?: (dirty: boolean) => void; refreshToken?: number; onStateChange?: (status: SettingsStatus) => void } = {}) {
  const [result, setResult] = useState<Result | null>(null);
  const [form, setForm] = useState<Settings | null>(null);
  const [custom, setCustom] = useState('');
  const [busy, setBusy] = useState(true);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState('');
  const [failed, setFailed] = useState(false);
  const [notice, setNotice] = useState('');
  useEffect(() => { onDirtyChange?.(dirty || !!custom.trim()); return () => onDirtyChange?.(false); }, [dirty, custom, onDirtyChange]);
  useEffect(() => {
    const controller = new AbortController(); setBusy(true); setFailed(false); setError('');
    void knowledgeRequest<Result>('agent-settings', undefined, controller.signal)
      .then(value => { if (!controller.signal.aborted) { setResult(value); setForm(value.settings); setDirty(false); setCustom(''); setNotice(''); } })
      .catch(reason => { if (!controller.signal.aborted) { setFailed(true); setError(reason.message); } })
      .finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, [refreshToken]);
  const ready = !!result && result.storageReady && result.serverEnabled && result.keyConfigured && result.settings.enabled && result.settings.enabled_models.includes(result.settings.model);
  useEffect(() => { onStateChange?.({ busy, ready, error: failed }); }, [busy, ready, failed, onStateChange]);
  const change = (update: Partial<Settings>) => { setForm(current => current ? { ...current, ...update } : current); setDirty(true); setNotice(''); };
  const save = async () => {
    if (!form || busy) return;
    setBusy(true); setFailed(false); setError(''); setNotice('');
    try {
      const value = await knowledgeRequest<{ settings: Settings }>('agent-settings', { enabled: form.enabled, model: form.model, enabledModels: form.enabled_models, version: form.version });
      setForm(value.settings); setResult(current => current ? { ...current, settings: value.settings } : current); setDirty(false); setNotice('Email agent settings saved. New drafts use these settings.');
    } catch (reason) { setFailed(true); setError(reason instanceof Error ? reason.message : 'Unable to save settings.'); }
    finally { setBusy(false); }
  };
  const models = [...new Set([...(result?.models || []), ...(form?.enabled_models || []), ...(form?.model ? [form.model] : [])])];
  return <SettingsCard label="Email agent settings" title="AI model" description="Choose the model used to prepare support replies." icon={<Sparkles className="h-4 w-4" />} badge={result ? result.settings.enabled ? 'Enabled' : 'Off' : undefined}>
    <AutoMailSnackbarArea>{error && <AutoMailSnackbar key={error} alert onDismiss={() => setError('')}>{error}</AutoMailSnackbar>}{notice && <AutoMailSnackbar key={notice} onDismiss={() => setNotice('')}>{notice}</AutoMailSnackbar>}</AutoMailSnackbarArea>
    {busy && !form && <p role="status" className="px-5 py-8 text-xs text-slate-500">Loading email agent settings...</p>}
    {form && result ? <form onSubmit={event => { event.preventDefault(); void save(); }}>
      <div className="divide-y divide-slate-100">
        {(!result.storageReady || !result.serverEnabled || !result.keyConfigured) && <p className="bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-800 sm:px-5">{!result.storageReady ? 'Model settings need database setup before they can be saved.' : 'AI needs server setup before it can prepare replies. Contact your developer to complete the configuration.'}</p>}
        <div className="px-4 py-4 sm:px-5"><SettingsToggle label="Enable AI reply suggestions" displayLabel="AI reply suggestions" description="Allow AI to prepare replies using approved knowledge." checked={form.enabled} disabled={busy || !result.storageReady} onChange={enabled => change({ enabled })} /></div>
        <div className="grid items-center gap-3 px-4 py-4 sm:grid-cols-[minmax(180px,1fr)_minmax(0,1.4fr)] sm:px-5">
          <div><label htmlFor="auto-mail-active-model" className="text-xs font-semibold text-slate-800">Active reply model</label><p className="mt-1 text-xs leading-5 text-slate-500">Used for new drafts and answer checks.</p></div>
          <select id="auto-mail-active-model" value={form.model} disabled={busy || !result.storageReady} onChange={event => change({ model: event.target.value, enabled_models: [...new Set([...form.enabled_models, event.target.value])] })} className={settingsInput}>{models.map(model => <option key={model} value={model}>{model}</option>)}</select>
        </div>
        <details className="px-4 py-4 sm:px-5">
          <summary className="cursor-pointer text-xs font-semibold text-slate-700">Available models &amp; usage</summary>
          <fieldset disabled={busy || !result.storageReady} className="mt-4 min-w-0 space-y-4">
            <legend className="sr-only">Enabled models</legend>
            <p className="text-xs leading-5 text-slate-500">Choose which models are available. Selecting a model above also enables it.</p>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{models.map(model => <label key={model} className="flex min-w-0 items-center gap-2 text-xs text-slate-600"><input type="checkbox" checked={form.enabled_models.includes(model)} onChange={event => change({ enabled_models: event.target.checked ? [...form.enabled_models, model] : form.enabled_models.filter(value => value !== model) })} className="h-3.5 w-3.5 shrink-0 accent-sky-600" /><span className="break-all">{model}</span></label>)}</div>
            <div className="flex flex-nowrap items-end gap-2"><label className="min-w-0 flex-1 text-xs font-medium text-slate-700">Other model ID<input value={custom} maxLength={100} onChange={event => setCustom(event.target.value)} className={`${settingsInput} mt-2`} placeholder="Enter a model ID" /></label><button type="button" disabled={!/^[a-zA-Z0-9._:-]{1,100}$/.test(custom)} onClick={() => { change({ enabled_models: [...new Set([...form.enabled_models, custom])] }); setCustom(''); }} className={`${settingsSecondary} mb-0.5`}><Plus aria-hidden="true" className="h-3.5 w-3.5" />Add model</button></div>
            <p className="text-xs leading-5 text-slate-500">Model access is checked when generating a reply. Usage follows your provider account's billing and data-sharing settings; choosing a model does not guarantee free usage or enable data sharing. <a href="https://help.openai.com/en/articles/10306912-sharing-feedback-evals-and-api-data-with-openai" target="_blank" rel="noopener noreferrer" className="text-sky-700 underline">Usage and data-sharing details</a></p>
          </fieldset>
        </details>
      </div>
      {form.enabled && !form.enabled_models.includes(form.model) && <p role="alert" className="px-5 pb-4 text-xs text-amber-800">Enable the active model or choose another enabled model before saving.</p>}
      <SettingsActions dirty={dirty} busy={busy} saveDisabled={busy || !dirty || !result.storageReady || (form.enabled && !form.enabled_models.includes(form.model))} saveLabel="Save agent settings" />
    </form> : null}
  </SettingsCard>;
}
