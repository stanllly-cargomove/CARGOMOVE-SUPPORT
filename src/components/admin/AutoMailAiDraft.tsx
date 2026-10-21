import React, { useRef, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { knowledgeRequest } from '../../services/autoMailKnowledge';

type Source = { id: string; title: string; port: string; version: number; content: string; cited: boolean };
type Draft = { id: string; status: 'READY' | 'NEEDS_REVIEW' | 'NO_ANSWER'; body: string; reviewNotes: string; provider: string; model: string; sources: Source[] };
type Props = {
  threadId: string; sourceMessageId: string; connectionVersion: string;
  enabled: boolean; disabled: boolean; setupMessage: string;
  onBusyChange: (busy: boolean) => void; onUse: (body: string, draftId: string) => void;
};

export function AutoMailAiDraft(props: Props) {
  const [scope, setScope] = useState('ALL');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const running = useRef(false);
  const generate = async () => {
    if (running.current || !props.enabled || props.disabled) return;
    running.current = true; setBusy('generate'); props.onBusyChange(true); setError(''); setNotice(''); setDraft(null);
    try {
      const result = await knowledgeRequest<{ draft?: Draft; message?: string }>('ai-generate', {
        requestId: crypto.randomUUID(), threadId: props.threadId, sourceMessageId: props.sourceMessageId, connectionVersion: props.connectionVersion, scope,
      });
      if (result.draft) setDraft(result.draft); else setNotice(result.message || 'No draft was generated.');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to generate a draft.'); }
    finally { running.current = false; setBusy(''); props.onBusyChange(false); }
  };
  const use = async () => {
    if (!draft || running.current || props.disabled) return;
    running.current = true; setBusy('use'); props.onBusyChange(true); setError('');
    try {
      const result = await knowledgeRequest<{ draft: Draft }>('ai-use', { draftId: draft.id, threadId: props.threadId, connectionVersion: props.connectionVersion });
      props.onUse(result.draft.body, result.draft.id);
      setNotice('Draft added to your reply. Review and edit it before sending.');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to use this draft.'); }
    finally { running.current = false; setBusy(''); props.onBusyChange(false); }
  };
  return <aside aria-label="AI reply suggestion" className="my-4 space-y-3 rounded-lg border border-violet-200 bg-violet-50/40 p-3">
    <h4 className="flex items-center gap-2 text-sm font-semibold text-slate-800"><Sparkles className="h-4 w-4 text-violet-600" />AI reply suggestion</h4>
    {!props.enabled ? <p className="text-xs text-slate-500">{props.setupMessage}</p> : <>
      <p className="text-xs text-slate-600">Generate a draft from approved KB articles. This sends up to six recent plain-text messages and matched KB excerpts to OpenAI.</p>
      <div className="flex flex-wrap items-end gap-2"><label className="min-w-0 flex-1 text-xs font-medium text-slate-600">Port / scope<input value={scope} maxLength={80} disabled={props.disabled || !!busy} onChange={event => { setScope(event.target.value); setDraft(null); setNotice(''); }} className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-xs" /></label><button type="button" onClick={() => void generate()} disabled={props.disabled || !!busy || !scope.trim()} className="rounded-lg bg-violet-600 px-3 py-2 text-xs font-medium text-white disabled:opacity-50">{busy === 'generate' ? 'Generating...' : 'Generate AI draft'}</button></div>
      <p className="text-xs text-slate-500">ALL uses general articles only. Enter NORTHPORT, WESTPORT, or the scope used in your KB for specific guidance.</p>
    </>}
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    {notice && <p role="status" className="text-xs text-slate-600">{notice}</p>}
    {draft && <div className="space-y-3 border-t border-violet-100 pt-3">
      <p className="text-xs font-medium text-slate-600">{draft.status === 'NO_ANSWER' ? 'The KB does not support a reliable answer.' : draft.status === 'NEEDS_REVIEW' ? 'Additional review or information is needed.' : 'Draft ready for staff review.'} · {draft.provider}</p>
      {draft.reviewNotes && <p className="whitespace-pre-wrap break-words rounded-lg bg-amber-50 p-3 text-xs text-amber-800">Staff notes: {draft.reviewNotes}</p>}
      {draft.body && <p className="whitespace-pre-wrap break-words rounded-lg border border-slate-200 bg-white p-3 text-sm text-slate-700">{draft.body}</p>}
      <div className="space-y-2"><h5 className="text-xs font-semibold text-slate-700">KB sources supplied to the model</h5>{draft.sources.map(source => <details key={source.id} className="rounded-lg border border-slate-200 bg-white p-2"><summary className="cursor-pointer break-words text-xs text-slate-700">{source.title} · {source.port} · v{source.version}{source.cited ? ' · Cited' : ''}</summary><p className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words text-xs text-slate-600">{source.content}</p></details>)}</div>
      {draft.status !== 'NO_ANSWER' && <button type="button" onClick={() => void use()} disabled={props.disabled || !!busy} className="rounded-lg border border-violet-200 bg-white px-3 py-2 text-xs font-medium text-violet-800 disabled:opacity-50">{busy === 'use' ? 'Checking sources...' : 'Add AI draft to reply'}</button>}
      <p className="text-xs text-slate-500">Source references do not guarantee correctness. Check the wording and operational details before sending.</p>
    </div>}
  </aside>;
}
