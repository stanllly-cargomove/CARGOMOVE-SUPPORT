import React, { useEffect, useRef, useState } from 'react';
import { KnowledgeArticle, knowledgeRequest } from '../../services/autoMailKnowledge';

type RelatedArticle = Pick<KnowledgeArticle, 'id' | 'title' | 'summary' | 'content' | 'category' | 'port' | 'version'>;

export function AutoMailRelatedKnowledge({ query, excludeId, disabled, onSelect }: {
  query: string; excludeId?: string; disabled?: boolean; onSelect?: (id: string) => void;
}) {
  const [articles, setArticles] = useState<RelatedArticle[]>([]);
  const [searched, setSearched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef<AbortController | null>(null);
  const searchText = query.trim().slice(0, 4000);

  useEffect(() => {
    setArticles([]); setSearched(false); setError(''); setBusy(false);
    return () => { pending.current?.abort(); };
  }, [searchText, excludeId]);

  const search = async () => {
    pending.current?.abort();
    const controller = new AbortController(); pending.current = controller;
    setBusy(true); setError('');
    try {
      const result = await knowledgeRequest<{ articles: RelatedArticle[] }>('knowledge-matches', { query: searchText }, controller.signal);
      if (!controller.signal.aborted) { setArticles(result.articles.filter(article => article.id !== excludeId)); setSearched(true); }
    } catch (reason) {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Unable to find related articles.');
    } finally { if (!controller.signal.aborted) setBusy(false); }
  };

  return <aside aria-label="Related approved knowledge" className="space-y-3 rounded-lg border border-sky-100 bg-sky-50/40 p-3">
    <p className="text-xs text-slate-600">Check existing approved answers before creating another article. Matches use the title, summary and keywords; compare the answer and scope.</p>
    <button type="button" disabled={disabled || busy || !searchText} onClick={() => void search()} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium hover:bg-slate-50 disabled:opacity-50">{busy ? 'Finding related articles...' : 'Find related approved articles'}</button>
    {error && <p role="alert" className="text-xs text-red-700">{error}</p>}
    {searched && !articles.length && <p role="status" className="text-xs text-slate-600">No other approved articles matched. Try different title words or keywords. Draft and archived articles are available in the KB list.</p>}
    {articles.map(article => <details key={article.id} className="rounded-lg border border-slate-200 bg-white p-3">
      <summary className="cursor-pointer break-words text-sm font-medium">{article.title} <span className="text-xs font-normal text-slate-500">{article.category} · {article.port} · v{article.version}</span></summary>
      <p className="mt-2 text-xs text-slate-500">{article.summary}</p>
      <p className="my-3 max-h-64 overflow-auto whitespace-pre-wrap break-words text-sm text-slate-700">{article.content}</p>
      {onSelect && <button type="button" disabled={disabled || busy} onClick={() => onSelect(article.id)} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium disabled:opacity-50">Compare as update target</button>}
    </details>)}
  </aside>;
}
