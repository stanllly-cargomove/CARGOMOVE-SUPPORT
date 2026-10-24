import React, { useContext, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AutoMailAiPreview } from './AutoMailAiPreview';
import { Sparkles } from 'lucide-react';
import { knowledgeRequest } from '../../services/autoMailKnowledge';

type Source = { id: string; title: string; port: string; version: number; content: string; cited: boolean };
type Draft = { id: string; status: 'READY' | 'NEEDS_REVIEW' | 'NO_ANSWER'; body: string; reviewNotes: string; provider: string; model: string; sources: Source[] };
type Props = {
  threadId: string; sourceMessageId: string; connectionVersion: string;
  enabled: boolean; disabled: boolean; setupMessage: string; onOpenSettings?: () => void;
  onBusyChange: (busy: boolean) => void; onUse: (body: string, draftId: string) => void;
};

export function AutoMailAiDraft(props: Props) {
  const preview = useContext(AutoMailAiPreview);
  const [inserted, setInserted] = useState(false);
  const [scope, setScope] = useState('');
  const [recommendation, setRecommendation] = useState<{ scope: string; reason: string; scopes: string[] } | null>(null);
  const [contextError, setContextError] = useState('');
  useEffect(() => {
    if (!props.enabled) return;
    const controller = new AbortController();
    setRecommendation(null); setContextError('');
    void knowledgeRequest<{ recommendation: { scope: string; reason: string; scopes: string[] } }>('ai-scope', {
      threadId: props.threadId, sourceMessageId: props.sourceMessageId, connectionVersion: props.connectionVersion,
    }, controller.signal).then(result => { if (!controller.signal.aborted) setRecommendation(result.recommendation); }).catch(() => {
      if (!controller.signal.aborted) setContextError('Scope preview is unavailable. Generate will check the current email again, or choose a scope.');
    });
    return () => controller.abort();
  }, [props.enabled, props.threadId, props.sourceMessageId, props.connectionVersion]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const pending = !!draft?.body && draft.status !== 'NO_ANSWER' && !inserted;
  const setPending = preview?.setPending;
  useEffect(() => { setPending?.(pending); return () => setPending?.(false); }, [pending, setPending]);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const running = useRef(false);
  const generate = async () => {
    if (running.current || !props.enabled || props.disabled) return;
    running.current = true; setBusy('generate'); props.onBusyChange(true); setError(''); setNotice(''); setDraft(null); setInserted(false);
    try {
      const result = await knowledgeRequest<{ draft?: Draft; message?: string }>('ai-generate', {
        requestId: crypto.randomUUID(), threadId: props.threadId, sourceMessageId: props.sourceMessageId, connectionVersion: props.connectionVersion, scope,
      });
      if (result.draft) setDraft(result.draft); else setNotice(result.message || 'No draft was generated.');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to generate a draft.'); }
    finally { running.current = false; setBusy(''); props.onBusyChange(false); }
  };
  const use = async () => {
    if (!draft || draft.status === 'NO_ANSWER' || inserted || running.current || props.disabled) return;
    running.current = true; setBusy('use'); props.onBusyChange(true); setError('');
    try {
      const result = await knowledgeRequest<{ draft: Draft }>('ai-use', { draftId: draft.id, threadId: props.threadId, connectionVersion: props.connectionVersion });
      props.onUse(result.draft.body, result.draft.id);
      setInserted(true);
      setNotice('Draft added to your reply. Review and edit it before sending.');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to use this draft.'); }
    finally { running.current = false; setBusy(''); props.onBusyChange(false); }
  };
  const suggestion = pending && <div aria-label="Unconfirmed AI reply" className="group relative rounded-lg bg-slate-50 px-4 py-3">
    <p className="mb-2 text-xs font-medium text-violet-700">AI suggestion · Insert or discard before sending</p>
    <p className="whitespace-pre-wrap break-words text-sm text-slate-400">{draft.body}</p>
    {draft.reviewNotes && <p className="mt-3 whitespace-pre-wrap text-xs text-amber-800">Staff notes: {draft.reviewNotes}</p>}
    {error && <p role="alert" className="mt-2 text-xs text-red-700">{error}</p>}
    <div className="sticky bottom-2 mt-3 flex gap-2 rounded-lg bg-white/95 p-2 shadow-sm sm:opacity-80 sm:group-hover:opacity-100 sm:focus-within:opacity-100">
      <button type="button" onClick={() => void use()} disabled={!props.enabled || props.disabled || !!busy} className="rounded-lg bg-violet-600 px-3 py-2 text-xs font-medium text-white disabled:opacity-50">{busy === 'use' ? 'Checking sources...' : 'Insert AI draft'}</button>
      <button type="button" onClick={() => { setDraft(null); setNotice('AI suggestion discarded.'); }} disabled={props.disabled || !!busy} className="rounded-lg border border-slate-200 px-3 py-2 text-xs text-slate-600 disabled:opacity-50">Discard suggestion</button>
    </div>
  </div>;
  return <><aside aria-label="AI reply suggestion" className="my-4 space-y-3 rounded-lg border border-violet-200 bg-violet-50/40 p-3">
    <h4 className="flex items-center gap-2 text-sm font-semibold text-slate-800"><Sparkles className="h-4 w-4 text-violet-600" />AI reply suggestion</h4>
    {!props.enabled && <div className="space-y-2"><p className="text-xs text-slate-600">{props.setupMessage}</p>{props.onOpenSettings&&<button type="button" onClick={props.onOpenSettings} disabled={props.disabled} className="text-xs font-semibold text-violet-700 underline disabled:opacity-50">Open Email agent settings</button>}</div>}
    <>
      <p className="text-xs text-slate-600">Generate a draft from approved KB articles. This sends up to six recent plain-text messages and matched KB excerpts to OpenAI.</p>
      <div className="flex flex-wrap items-end gap-2"><label className="min-w-0 flex-1 text-xs font-medium text-slate-600">Port / scope<select aria-label="Port / scope" value={scope} disabled={!props.enabled || props.disabled || !!busy} onChange={event => { setScope(event.target.value); setDraft(null); setNotice(''); }} className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"><option value="">Auto — read this email{recommendation ? ` (${recommendation.scope})` : ''}</option><option value="ALL">ALL — general guidance</option>{recommendation?.scopes.map(port => <option key={port} value={port}>{port}</option>)}</select></label><button type="button" onClick={() => void generate()} disabled={!props.enabled || props.disabled || !!busy} className="rounded-lg bg-violet-600 px-3 py-2 text-xs font-medium text-white disabled:opacity-50">{busy === 'generate' ? 'Generating...' : 'Generate AI draft'}</button></div>
      <p role="status" className="text-xs text-slate-500">{scope ? `Using ${scope}.` : contextError || recommendation?.reason || (props.enabled ? 'Reading the email to suggest a scope...' : 'Auto scope will read the email when AI is available.')}</p>
    </>
    {error && !pending && <p role="alert" className="text-sm text-red-700">{error}</p>}
    {notice && <p role="status" className="text-xs text-slate-600">{notice}</p>}
    {draft && <div className="space-y-3 border-t border-violet-100 pt-3">
      <p className="text-xs font-medium text-slate-600">{draft.status === 'NO_ANSWER' ? 'The KB does not support a reliable answer.' : draft.status === 'NEEDS_REVIEW' ? 'Additional review or information is needed.' : 'Draft ready for staff review.'} · {draft.provider}</p>
      {draft.reviewNotes && <p className="whitespace-pre-wrap break-words rounded-lg bg-amber-50 p-3 text-xs text-amber-800">Staff notes: {draft.reviewNotes}</p>}
      <div className="space-y-2"><h5 className="text-xs font-semibold text-slate-700">KB sources supplied to the model</h5>{draft.sources.map(source => <details key={source.id} className="rounded-lg border border-slate-200 bg-white p-2"><summary className="cursor-pointer break-words text-xs text-slate-700">{source.title} · {source.port} · v{source.version}{source.cited ? ' · Cited' : ''}</summary><p className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words text-xs text-slate-600">{source.content}</p></details>)}</div>
      <p className="text-xs text-slate-500">Source references do not guarantee correctness. Check the wording and operational details before sending.</p>
    </div>}
  </aside>{preview?.target ? createPortal(suggestion, preview.target) : !preview ? suggestion : null}</>;
}
