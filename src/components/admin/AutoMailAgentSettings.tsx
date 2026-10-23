import {AutoMailIncomingSettings} from './AutoMailIncomingSettings';
import React, { useEffect, useState } from 'react';
import { knowledgeRequest } from '../../services/autoMailKnowledge';

type Settings = { enabled: boolean; model: string; enabled_models: string[]; version: number };
type Result = { settings: Settings; models: string[]; storageReady: boolean; serverEnabled: boolean; keyConfigured: boolean };

export function AutoMailAgentSettings() {
  const [incomingOpen,setIncomingOpen]=useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [form, setForm] = useState<Settings | null>(null);
  const [custom, setCustom] = useState('');
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  useEffect(() => {
    const controller = new AbortController(); setBusy(true); setError('');
    void knowledgeRequest<Result>('agent-settings', undefined, controller.signal)
      .then(value => { if (!controller.signal.aborted) { setResult(value); setForm(value.settings); setDirty(false); setNotice(''); } })
      .catch(reason => { if (!controller.signal.aborted) setError(reason.message); })
      .finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, [attempt]);
  const change = (update: Partial<Settings>) => { setForm(current => current ? { ...current, ...update } : current); setDirty(true); setNotice(''); };
  const save = async () => {
    if (!form || busy) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const value = await knowledgeRequest<{ settings: Settings }>('agent-settings', { enabled: form.enabled, model: form.model, enabledModels: form.enabled_models, version: form.version });
      setForm(value.settings); setDirty(false); setNotice('Email agent settings saved. New drafts use these settings.');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to save settings.'); }
    finally { setBusy(false); }
  };
  const models = [...new Set([...(result?.models || []), ...(form?.enabled_models || []), ...(form?.model ? [form.model] : [])])];
  return <section aria-label="Email agent settings" className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="font-semibold text-slate-900">Email agent model</h3><p className="mt-1 text-xs text-slate-500">Control AI reply suggestions. Sending still requires staff review.</p></div><button type="button" disabled={busy} onClick={() => { if (!dirty || window.confirm('Discard unsaved model settings and reload?')) setAttempt(value => value + 1); }} className="rounded-lg border border-slate-200 px-3 py-2 text-xs disabled:opacity-50">Reload model settings</button></div>
    {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    {notice && <p role="status" className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}
    {busy && !form && <p role="status" className="text-sm text-slate-500">Loading email agent settings...</p>}
    {form && result && <form onSubmit={event => { event.preventDefault(); void save(); }} className="space-y-4">
      {!result.storageReady && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">Apply 20261022050000_agent_settings.sql in the separate Auto Mail database to save model settings. Current server settings remain in use until then.</p>}
      {(!result.serverEnabled || !result.keyConfigured) && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">AI also requires the server enable flag and OpenAI API key. Contact the developer to configure them.</p>}
      <label className="flex items-center gap-3 text-sm font-medium"><input type="checkbox" checked={form.enabled} disabled={busy || !result.storageReady} onChange={event => change({ enabled: event.target.checked })} className="h-4 w-4" />Enable AI reply suggestions</label>
      <label className="block text-sm font-medium">Active reply model<select value={form.model} disabled={busy || !result.storageReady} onChange={event => change({ model: event.target.value, enabled_models: [...new Set([...form.enabled_models, event.target.value])] })} className="mt-2 block w-full max-w-lg rounded-lg border border-slate-300 bg-white p-3 text-sm">{models.map(model => <option key={model} value={model}>{model}</option>)}</select></label>
      <fieldset disabled={busy || !result.storageReady} className="rounded-lg border border-slate-200 p-4"><legend className="px-1 text-sm font-medium">Enabled models</legend><p className="mb-3 text-xs text-slate-500">Only the active enabled model generates replies. Disabling it requires choosing another model or turning suggestions off.</p><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{models.map(model => <label key={model} className="flex min-w-0 items-center gap-2 text-sm"><input type="checkbox" checked={form.enabled_models.includes(model)} onChange={event => change({ enabled_models: event.target.checked ? [...form.enabled_models, model] : form.enabled_models.filter(value => value !== model) })} /><span className="break-all">{model}</span></label>)}</div>
        <div className="mt-4 flex flex-wrap items-end gap-2"><label className="min-w-0 flex-1 text-xs font-medium">Other model ID<input value={custom} maxLength={100} onChange={event => setCustom(event.target.value)} className="mt-1 block w-full rounded-lg border border-slate-300 p-2 text-sm" placeholder="Model available to your OpenAI project" /></label><button type="button" disabled={!/^[a-zA-Z0-9._:-]{1,100}$/.test(custom)} onClick={() => { change({ enabled_models: [...new Set([...form.enabled_models, custom])] }); setCustom(''); }} className="rounded-lg border border-slate-200 px-3 py-2 text-xs disabled:opacity-50">Add model</button></div>
      </fieldset>
      <p className="text-xs leading-5 text-slate-500">Model access is checked when generating a draft. OpenAI's complimentary token offer depends on your organization's eligibility, data-sharing settings, supported models and remaining daily allowance. Choosing a model here does not enable data sharing or enforce a free-token limit. Shared email content may be used to improve OpenAI models. <a href="https://help.openai.com/en/articles/10306912-sharing-feedback-evals-and-api-data-with-openai" target="_blank" rel="noopener noreferrer" className="text-sky-700 underline">Offer and data-sharing details</a></p>
      {form.enabled && !form.enabled_models.includes(form.model) && <p role="alert" className="text-sm text-amber-800">Enable the active model or choose another enabled model before saving.</p>}
      <button type="submit" disabled={busy || !dirty || !result.storageReady || (form.enabled && !form.enabled_models.includes(form.model))} className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">{busy ? 'Saving...' : 'Save agent settings'}</button>
    </form>}
  <details onToggle={event=>{if(event.currentTarget.open)setIncomingOpen(true);}} className="border-t border-slate-200 pt-4"><summary className="cursor-pointer text-sm font-semibold text-slate-700">Automatic incoming drafts</summary>{incomingOpen&&<AutoMailIncomingSettings/>}</details>
  </section>;
}
