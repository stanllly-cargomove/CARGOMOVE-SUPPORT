import React, { useEffect, useRef, useState } from 'react';
import { getKnowledge, saveKnowledge } from '../../../services/knowledge';
import type {
  SupportKnowledge,
  KnowledgeFilters,
} from '../../../types/knowledge';
import {
  SUPPORT_CATEGORIES,
  SUPPORT_SUBCATEGORIES,
  SUPPORT_PORTS,
} from '../../../types/support';
import { useSupportResource } from '../../../hooks/support/useSupportResource';
import { supportLabel } from '../../../utils/support/status';
import { KnowledgeEditor } from './KnowledgeEditor';
export function KnowledgeBase() {
  const [filters, setFilters] = useState<KnowledgeFilters>({ offset: 0 }),
    [search, setSearch] = useState(''),
    [revision, setRevision] = useState(0);
  const [editing, setEditing] = useState<SupportKnowledge | null | undefined>(
      undefined,
    ),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const writing = useRef(false);
  useEffect(() => {
    const timer = setTimeout(
      () => setFilters((f) => ({ ...f, q: search.trim(), offset: 0 })),
      300,
    );
    return () => clearTimeout(timer);
  }, [search]);
  const resource = useSupportResource(
    `${JSON.stringify(filters)}:${revision}`,
    (signal) => getKnowledge(filters, signal),
  );
  const offset = filters.offset || 0;
  useEffect(() => {
    if (resource.data && offset >= resource.data.total && offset > 0)
      setFilters((f) => ({
        ...f,
        offset: Math.max(0, Math.floor((resource.data!.total - 1) / 20) * 20),
      }));
  }, [resource.data, offset]);
  function saved(article: SupportKnowledge) {
    setEditing(article);
    setRevision((v) => v + 1);
    setError('');
  }
  async function toggle(article: SupportKnowledge) {
    if (writing.current) return;
    writing.current = true;
    setBusy(true);
    setError('');
    try {
      const updated = await saveKnowledge(
        { ...article, active: !article.active },
        article,
      );
      if (editing?.id === article.id) setEditing(undefined);
      setRevision((v) => v + 1);
      setError(
        `${updated.knowledge_code} ${updated.active ? 'activated' : 'deactivated'}.`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to update article.');
    } finally {
      writing.current = false;
      setBusy(false);
    }
  }
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Knowledge Base</h1>
          <p className="mt-1 text-sm text-slate-500">
            Staff-approved CargoMove support guidance
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setRevision((v) => v + 1)}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold"
          >
            Refresh articles
          </button>
          <button
            type="button"
            onClick={() => setEditing(null)}
            className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white"
          >
            Create article
          </button>
        </div>
      </div>
      <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
        <label className="block text-xs font-semibold text-slate-600">
          Search knowledge
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search guidance, code or keywords…"
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
        </label>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
          {(
            [
              ['category', 'Category', SUPPORT_CATEGORIES],
              ['subcategory', 'Subcategory', SUPPORT_SUBCATEGORIES],
              ['port', 'Port', [...SUPPORT_PORTS, 'ALL']],
              ['active', 'Active', ['true', 'false']],
              ['ai_reply_allowed', 'AI reply allowed', ['true', 'false']],
              [
                'human_review_required',
                'Human review required',
                ['true', 'false'],
              ],
            ] as const
          ).map(([key, label, values]) => (
            <label key={key} className="text-xs font-semibold text-slate-600">
              {label}
              <select
                aria-label={`Filter ${label}`}
                value={String(filters[key] || '')}
                onChange={(e) =>
                  setFilters((f) => ({
                    ...f,
                    [key]: e.target.value,
                    offset: 0,
                  }))
                }
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2 py-2 text-sm"
              >
                <option value="">All</option>
                {values.map((v) => (
                  <option key={v} value={v}>
                    {v === 'true'
                      ? 'Yes'
                      : v === 'false'
                        ? 'No'
                        : supportLabel(v)}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
      </div>
      {error && (
        <p role="status" className="text-sm text-slate-700">
          {error}
        </p>
      )}
      <div className="grid items-start gap-5 xl:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          {resource.loading ? (
            <p role="status" className="text-sm text-slate-500">
              Loading knowledge…
            </p>
          ) : resource.error ? (
            <p role="alert" className="text-sm text-rose-700">
              {resource.error}
            </p>
          ) : (
            <>
              <p className="mb-3 text-xs text-slate-500">
                {resource.data?.total || 0} articles
              </p>
              {resource.data?.articles.length ? (
                resource.data.articles.map((article) => (
                  <article
                    key={article.id}
                    className="mb-3 rounded-lg border border-slate-200 p-3"
                  >
                    <div className="flex flex-wrap justify-between gap-2">
                      <h2 className="break-words font-semibold text-slate-900">
                        {article.title}
                      </h2>
                      <span
                        className={`text-xs font-semibold ${article.active ? 'text-emerald-700' : 'text-slate-500'}`}
                      >
                        {article.active ? 'Active' : 'Inactive'}
                      </span>
                    </div>
                    <p className="mt-1 break-words text-xs text-slate-500">
                      {article.knowledge_code} ·{' '}
                      {supportLabel(article.category)} ·{' '}
                      {supportLabel(article.port)}
                    </p>
                    <p className="mt-2 break-words text-sm text-slate-700">
                      {article.problem}
                    </p>
                    <p className="mt-2 text-xs text-slate-500">
                      {article.human_review_required
                        ? 'Human review required'
                        : 'Human review optional'}{' '}
                      ·{' '}
                      {article.ai_reply_allowed
                        ? 'AI reply allowed'
                        : 'AI reply disabled'}
                    </p>
                    <div className="mt-3 flex gap-3 text-xs font-semibold">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => setEditing(article)}
                        className="text-blue-600"
                      >
                        Edit {article.knowledge_code}
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => toggle(article)}
                        className="text-slate-600"
                      >
                        {article.active ? 'Deactivate' : 'Activate'}{' '}
                        {article.knowledge_code}
                      </button>
                    </div>
                  </article>
                ))
              ) : (
                <p className="py-6 text-sm text-slate-500">
                  No Knowledge Base articles found.
                </p>
              )}
              <div className="mt-4 flex items-center justify-between gap-2 text-xs">
                <button
                  type="button"
                  disabled={offset === 0}
                  onClick={() =>
                    setFilters((f) => ({
                      ...f,
                      offset: Math.max(0, offset - 20),
                    }))
                  }
                  className="rounded-lg border px-3 py-2 disabled:opacity-40"
                >
                  Previous articles
                </button>
                <span>
                  {resource.data?.total
                    ? `${offset + 1}–${Math.min(offset + 20, resource.data.total)} of ${resource.data.total}`
                    : '0 articles'}
                </span>
                <button
                  type="button"
                  disabled={offset + 20 >= (resource.data?.total || 0)}
                  onClick={() =>
                    setFilters((f) => ({ ...f, offset: offset + 20 }))
                  }
                  className="rounded-lg border px-3 py-2 disabled:opacity-40"
                >
                  Next articles
                </button>
              </div>
            </>
          )}
        </div>
        {editing !== undefined ? (
          <KnowledgeEditor
            key={editing ? `${editing.id}:${editing.updated_at}` : 'new'}
            article={editing}
            onSaved={saved}
            onClose={() => setEditing(undefined)}
          />
        ) : (
          <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
            Select an article to edit, or create new guidance. Articles start
            inactive.
          </div>
        )}
      </div>
    </div>
  );
}
