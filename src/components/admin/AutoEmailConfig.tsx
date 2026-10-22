import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, BookOpen, GraduationCap, RefreshCw, Settings } from 'lucide-react';
import { AutoMailKnowledge } from './AutoMailKnowledge';
import { AutoMailLearning } from './AutoMailLearning';
import { AutoMailAgentSettings } from './AutoMailAgentSettings';
import { knowledgeRequest } from '../../services/autoMailKnowledge';

export type AutoEmailConfigTab = 'knowledge' | 'learning' | 'agent';
const tabs = [
  { id: 'knowledge', label: 'Knowledge Base', icon: BookOpen },
  { id: 'learning', label: 'Learning review', icon: GraduationCap },
  { id: 'agent', label: 'Email agent', icon: Settings },
] as const;

export function AutoEmailConfig({ onBack, initialTab = 'knowledge' }: { onBack: () => void; initialTab?: AutoEmailConfigTab }) {
  const [tab, setTab] = useState<AutoEmailConfigTab>(initialTab);
  const [status, setStatus] = useState<{ knowledgeReady: boolean; learningReady: boolean; message: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [revision, setRevision] = useState(0);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  useEffect(() => {
    tabRefs.current[tabs.findIndex(item => item.id === tab)]?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [tab]);
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError('');
    void knowledgeRequest<NonNullable<typeof status>>('status', undefined, controller.signal)
      .then(result => { if (!controller.signal.aborted) setStatus(result); })
      .catch(reason => { if (!controller.signal.aborted) { setStatus(null); setError(reason.message); } })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [attempt]);

  return <section className="space-y-4">
    <div><h2 className="text-xl font-bold text-slate-900">Auto Email Config</h2><p className="mt-1 text-sm text-slate-500">Manage approved support knowledge and review learning from sent replies.</p></div>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <button type="button" onClick={onBack} className="inline-flex items-center gap-2 text-sm text-slate-600 hover:text-sky-700"><ArrowLeft className="h-4 w-4" />Dev Setting</button>
      <button type="button" disabled={loading} onClick={() => setAttempt(value => value + 1)} className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs disabled:opacity-50"><RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />Check connection</button>
    </div>
    {loading && <p role="status" className="text-sm text-slate-500">Checking Auto Email configuration...</p>}
    {error && <p role="alert" className="rounded-lg bg-amber-50 p-4 text-sm text-amber-800">{error}</p>}
    <div>
    <div className="overflow-x-auto"><div role="tablist" aria-label="Auto Email Config" className="ml-[0.5px] flex w-fit items-end pt-1">
      {tabs.map((item, index) => <button key={item.id} ref={element => { tabRefs.current[index] = element; }} type="button" id={`auto-email-config-tab-${item.id}`} role="tab" aria-selected={tab === item.id} aria-controls={`auto-email-config-panel-${item.id}`} tabIndex={tab === item.id ? 0 : -1}
        onClick={() => setTab(item.id)} onKeyDown={event => {
          const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : null;
          if (next !== null) { event.preventDefault(); setTab(tabs[next].id); tabRefs.current[next]?.focus(); }
        }} className={`admin-registration-tab relative -mr-px inline-flex h-10 min-w-[152px] shrink-0 items-center justify-center gap-2 rounded-t-lg border px-3 text-xs font-bold uppercase tracking-wider transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sky-500 ${tab === item.id ? 'z-10 border-slate-400 border-b-transparent bg-[#CBD5E1] text-slate-900' : 'border-slate-300 bg-[#F1F5F9] text-slate-500 hover:bg-slate-200 hover:text-slate-900'}`}><item.icon className="h-4 w-4 shrink-0" />{item.label}</button>)}
    </div></div>
    <div className="rounded-b-xl rounded-tr-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
    {/* Keep both editors mounted across tab changes so unsaved review work is preserved. */}
    <div id="auto-email-config-panel-knowledge" role="tabpanel" aria-labelledby="auto-email-config-tab-knowledge" hidden={tab !== 'knowledge'} tabIndex={0}>
      {status && (status.knowledgeReady ? <AutoMailKnowledge ready refreshToken={attempt + revision} /> : <p className="rounded-lg bg-amber-50 p-4 text-sm text-amber-800">{status.message || 'Knowledge base setup is not ready. Check the Auto Mail database configuration.'}</p>)}
    </div>
    <div id="auto-email-config-panel-learning" role="tabpanel" aria-labelledby="auto-email-config-tab-learning" hidden={tab !== 'learning'} tabIndex={0}>
      {status && <AutoMailLearning ready={!!status.learningReady} refreshToken={attempt} onReviewed={() => setRevision(value => value + 1)} />}
    </div>
    <div id="auto-email-config-panel-agent" role="tabpanel" aria-labelledby="auto-email-config-tab-agent" hidden={tab !== 'agent'} tabIndex={0}><AutoMailAgentSettings /></div>
    </div>
    </div>
  </section>;
}
