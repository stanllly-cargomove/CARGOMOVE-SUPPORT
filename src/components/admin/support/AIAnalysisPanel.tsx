import { SuggestedReplyEditor } from './SuggestedReplyEditor';
import { KnowledgeMatchesPanel } from './KnowledgeMatchesPanel';
import React, { useRef, useState } from 'react';
import {
  getSupportAnalysis,
  analyzeSupportCase,
} from '../../../services/supportAI';
import { useSupportResource } from '../../../hooks/support/useSupportResource';
import { supportLabel } from '../../../utils/support/status';
export function AIAnalysisPanel({
  caseId,
  resolved,
  onAnalyzed,
}: {
  caseId: string;
  resolved: boolean;
  onAnalyzed: () => void;
}) {
  const [revision, setRevision] = useState(0),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const active = useRef(false);
  const resource = useSupportResource(`${caseId}:${revision}`, (signal) =>
    getSupportAnalysis(caseId, signal),
  );
  const item = resource.data?.interaction;
  async function run() {
    if (active.current) return;
    active.current = true;
    setBusy(true);
    setError('');
    try {
      await analyzeSupportCase(caseId);
      setRevision((v) => v + 1);
      onAnalyzed();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : 'AI is unavailable. Continue handling the case manually.',
      );
    } finally {
      active.current = false;
      setBusy(false);
    }
  }
  const confidence = item ? Math.round(item.confidence * 100) : 0;
  return (
    <section
      className="rounded-xl border border-slate-200 bg-white p-4"
      aria-label="AI analysis"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-sm font-bold text-slate-900">AI analysis</h3>
        <button
          type="button"
          onClick={run}
          disabled={busy || resolved}
          className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-40"
        >
          {busy ? 'Analyzing…' : 'Analyze case'}
        </button>
      </div>
      <p className="mt-2 text-xs text-slate-500">
        Classification assists staff. Human review is required.
      </p>
      {(error || resource.error) && (
        <p role="alert" className="mt-3 text-sm text-rose-700">
          {error || resource.error}
        </p>
      )}
      {resource.loading ? (
        <p role="status" className="mt-3 text-sm text-slate-500">
          Loading saved analysis…
        </p>
      ) : item ? (
        <div className="mt-3 space-y-3 text-sm">
          {resource.data?.stale && (
            <p className="rounded-lg bg-amber-50 p-2 text-amber-800">
              New or changed messages are not included in this analysis. Analyze
              the case again.
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`rounded-full px-2 py-1 text-xs font-semibold ${item.confidence >= 0.9 ? 'bg-emerald-100 text-emerald-800' : item.confidence >= 0.7 ? 'bg-amber-100 text-amber-800' : 'bg-rose-100 text-rose-800'}`}
            >
              {confidence}% confidence
            </span>
            <span className="rounded-full bg-amber-100 px-2 py-1 text-xs font-semibold text-amber-800">
              Human review required
            </span>
          </div>
          <p className="text-slate-700">
            {supportLabel(item.category)}
            {item.subcategory
              ? ` · ${supportLabel(item.subcategory)}`
              : ''} · {supportLabel(item.port)} · {supportLabel(item.urgency)}{' '}
            urgency · {item.language}
          </p>
          <p className="break-words text-slate-700">{item.short_explanation}</p>
          <p className="text-slate-700">
            <strong>Suggested staff action:</strong>{' '}
            {supportLabel(item.recommended_action || 'MANUAL_REVIEW')}
          </p>
          {Object.values(item.entities).some(Boolean) && (
            <dl className="grid gap-2 sm:grid-cols-2">
              {Object.entries(item.entities)
                .filter(([, value]) => value)
                .map(([key, value]) => (
                  <div
                    key={key}
                    className="break-words rounded-lg bg-slate-50 p-2"
                  >
                    <dt className="text-xs font-semibold text-slate-500">
                      {supportLabel(key)}
                    </dt>
                    <dd className="mt-1 text-slate-700">{value}</dd>
                  </div>
                ))}
            </dl>
          )}
        </div>
      ) : (
        !resource.error && (
          <p className="mt-3 text-sm text-slate-500">
            No AI analysis has been run for this case.
          </p>
        )
      )}
      {item && (
        <SuggestedReplyEditor
          caseId={caseId}
          analysisId={item.id}
          onDelivered={onAnalyzed}
          blocked={resolved || !!resource.data?.stale}
        />
      )}
      {item && (
        <KnowledgeMatchesPanel caseId={caseId} interactionId={item.id} />
      )}
    </section>
  );
}
