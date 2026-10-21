import React, { useEffect, useState } from 'react';
import { ArrowLeft, RefreshCw } from 'lucide-react';
import { AutoMailKnowledge } from './AutoMailKnowledge';
import { knowledgeRequest } from '../../services/autoMailKnowledge';

export function AutoMailKnowledgePage({ onBack }: { onBack: () => void }) {
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError('');
    void knowledgeRequest<{ knowledgeReady: boolean; message: string }>('status', undefined, controller.signal)
      .then(result => { if (!controller.signal.aborted) { setReady(!!result.knowledgeReady); if (!result.knowledgeReady) setError(result.message); } })
      .catch(reason => { if (!controller.signal.aborted) { setReady(false); setError(reason.message); } })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [attempt]);
  return <section className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><button type="button" onClick={onBack} className="inline-flex items-center gap-2 text-sm text-slate-600 hover:text-sky-700"><ArrowLeft className="h-4 w-4" />Dev Setting</button><button type="button" disabled={loading} onClick={() => setAttempt(value => value + 1)} className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs disabled:opacity-50"><RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />Check connection</button></div>
    {loading ? <p role="status" className="text-sm text-slate-500">Checking knowledge base connection...</p> : ready ? <AutoMailKnowledge ready refreshToken={attempt} /> : <p role="alert" className="rounded-lg bg-amber-50 p-4 text-sm text-amber-800">{error || 'Knowledge base setup is not ready. Check the Auto Mail database configuration.'}</p>}
  </section>;
}
