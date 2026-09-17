import React, { useState } from 'react';
import { getKnowledgeMatches } from '../../../services/knowledge';
import { useSupportResource } from '../../../hooks/support/useSupportResource';
import { supportLabel } from '../../../utils/support/status';
export function KnowledgeMatchesPanel({
  caseId,
  interactionId,
}: {
  caseId: string;
  interactionId: string;
}) {
  const [revision, setRevision] = useState(0);
  const resource = useSupportResource(
    `${caseId}:${interactionId}:${revision}`,
    (signal) => getKnowledgeMatches(caseId, signal),
  );
  return (
    <section
      className="mt-4 border-t border-slate-200 pt-4"
      aria-label="Matching knowledge"
    >
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-sm font-bold text-slate-900">
          Matching approved knowledge
        </h4>
        <button
          type="button"
          onClick={() => setRevision((v) => v + 1)}
          className="text-xs font-semibold text-blue-600"
        >
          Refresh matches
        </button>
      </div>
      <p className="mt-1 text-xs text-slate-500">
        Guidance matched to the classification; staff must verify its
        applicability.
      </p>
      {resource.loading ? (
        <p role="status" className="mt-3 text-sm text-slate-500">
          Finding knowledge…
        </p>
      ) : resource.error ? (
        <p role="alert" className="mt-3 text-sm text-rose-700">
          {resource.error}
        </p>
      ) : resource.data?.stale ? (
        <p className="mt-3 text-sm text-amber-700">
          Analyze the changed conversation again before matching knowledge.
        </p>
      ) : resource.data?.articles.length ? (
        <div className="mt-3 space-y-3">
          {resource.data.articles.map((k) => (
            <details
              key={k.id}
              className="rounded-lg border border-slate-200 p-3"
            >
              <summary className="cursor-pointer break-words text-sm font-semibold text-slate-900">
                {k.knowledge_code} · {k.title}
              </summary>
              <div className="mt-3 space-y-2 break-words text-sm text-slate-700">
                <p className="text-xs text-slate-500">
                  {supportLabel(k.category)} · {supportLabel(k.port)} ·{' '}
                  {k.human_review_required
                    ? 'Human review required'
                    : 'Human review optional'}{' '}
                  ·{' '}
                  {k.ai_reply_allowed
                    ? 'AI reply allowed'
                    : 'AI reply disabled'}
                </p>
                {k.requires_port_verification && (
                  <p className="font-semibold text-amber-700">
                    Requires port verification
                  </p>
                )}
                <p className="whitespace-pre-wrap">
                  <strong>Problem:</strong> {k.problem}
                </p>
                {k.possible_cause && (
                  <p className="whitespace-pre-wrap">
                    <strong>Possible cause:</strong> {k.possible_cause}
                  </p>
                )}
                <p className="whitespace-pre-wrap">
                  <strong>Resolution:</strong> {k.resolution}
                </p>
                {k.suggested_action && (
                  <p className="whitespace-pre-wrap">
                    <strong>Suggested action:</strong> {k.suggested_action}
                  </p>
                )}
              </div>
            </details>
          ))}
        </div>
      ) : (
        <p className="mt-3 text-sm text-slate-500">
          No approved knowledge matches this classification.
        </p>
      )}
    </section>
  );
}
