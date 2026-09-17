import { useRef, useState } from "react";
import {
  detectLearning,
  getLearning,
  listLearning,
  reviewLearning,
  type LearningDetail,
} from "../../../services/supportLearning";
import type { KnowledgeArticleInput } from "../../../types/knowledge";
import { useSupportResource } from "../../../hooks/support/useSupportResource";
import { KnowledgeEditor } from "./KnowledgeEditor";
import { supportLabel, supportTime } from "../../../utils/support/status";
function Review({
  detail,
  onChanged,
}: {
  detail: LearningDetail;
  onChanged: () => void;
}) {
  const { suggestion: s, knowledge: k, evidence } = detail;
  const [editing, setEditing] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const working = useRef(false);
  const initial: KnowledgeArticleInput = {
    knowledge_code:
      k?.knowledge_code || "LEARN-" + s.id.slice(0, 8).toUpperCase(),
    title: k?.title || s.suggested_problem,
    category: s.category,
    subcategory: s.subcategory,
    port: s.port,
    problem: s.suggested_problem,
    resolution: s.suggested_resolution,
    possible_cause: k?.possible_cause || null,
    suggested_action: s.suggested_action,
    keywords: k?.keywords || [],
    requires_port_verification: k?.requires_port_verification || false,
    human_review_required: true,
    ai_reply_allowed: k?.ai_reply_allowed || false,
    active: k?.active || false,
  };
  async function reject() {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    setError("");
    try {
      await reviewLearning(s);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to reject.");
    } finally {
      working.current = false;
      setBusy(false);
    }
  }
  return (
    <section
      aria-label="Learning review"
      className="space-y-4 rounded-xl border border-slate-200 bg-white p-5"
    >
      <h2 className="text-lg font-bold">{s.suggested_problem}</h2>
      <p className="text-sm text-slate-600">
        {supportLabel(s.category)} · {supportLabel(s.subcategory || "")} ·{" "}
        {supportLabel(s.port)} · {s.evidence_count} distinct cases · {s.status}
      </p>
      <p className="text-sm text-amber-800">
        Repeated wording is evidence for review, not a verified operational
        procedure. Remove customer-specific identifiers and verify guidance
        before approving.
      </p>
      <div>
        <h3 className="text-sm font-bold">Current knowledge</h3>
        <p className="mt-2 whitespace-pre-wrap break-words text-sm">
          {k
            ? `${k.knowledge_code} · ${k.title}\n${k.resolution}`
            : "No single shared source. Approval creates a new article."}
        </p>
      </div>
      {k && k.updated_at !== s.knowledge_version && (
        <p className="text-sm text-amber-800">
          Linked knowledge changed since detection. This proposal cannot
          overwrite it; review the current article in Knowledge Base.
        </p>
      )}
      <div>
        <h3 className="text-sm font-bold">Suggested improvement</h3>
        <p className="mt-2 whitespace-pre-wrap break-words text-sm">
          {s.suggested_resolution}
        </p>
      </div>
      <details>
        <summary className="cursor-pointer text-sm font-semibold">
          Correction evidence ({s.evidence_count} cases; latest 20 shown)
        </summary>
        {evidence.map((e) => (
          <article
            key={e.interaction_id}
            className="mt-3 rounded-lg border border-slate-200 p-3 text-sm"
          >
            <a
              href={`/admin/support/case/${e.case_id}`}
              className="text-blue-600 underline"
            >
              Open case
            </a>
            <p className="mt-2 text-xs text-slate-500">
              Reviewed by {e.approved_by} · {supportTime(e.approved_at)}
            </p>
            <h4 className="mt-2 font-semibold">Generated reply</h4>
            <p className="whitespace-pre-wrap break-words">
              {e.generated_reply}
            </p>
            <h4 className="mt-2 font-semibold">Final sent reply</h4>
            <p className="whitespace-pre-wrap break-words">{e.final_reply}</p>
          </article>
        ))}
      </details>
      {s.status === "PENDING" && (
        <div className="flex gap-3">
          <button
            type="button"
            disabled={busy}
            onClick={() => setEditing(true)}
            className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white"
          >
            Edit & approve
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={reject}
            className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold"
          >
            Reject
          </button>
        </div>
      )}
      {error && (
        <p role="alert" className="text-sm text-rose-700">
          {error}
        </p>
      )}
      {s.approved_article && (
        <div>
          <h3 className="text-sm font-bold">Approved knowledge snapshot</h3>
          <p className="mt-2 whitespace-pre-wrap break-words text-sm">
            {s.approved_article.knowledge_code} · {s.approved_article.title}
            {"\n"}
            {s.approved_article.resolution}
          </p>
        </div>
      )}
      {s.reviewed_by && (
        <p className="text-xs text-slate-500">
          Reviewed by {s.reviewed_by} · {supportTime(s.reviewed_at)}
        </p>
      )}
      {editing && (
        <KnowledgeEditor
          article={k}
          initial={initial}
          submitLabel="Approve suggestion and save knowledge"
          onSave={async (input) => (await reviewLearning(s, input)).article}
          onSaved={() => {
            setEditing(false);
            onChanged();
          }}
          onClose={() => setEditing(false)}
        />
      )}
    </section>
  );
}
export function LearningSuggestions() {
  const [status, setStatus] = useState("PENDING"),
    [offset, setOffset] = useState(0),
    [revision, setRevision] = useState(0),
    [selected, setSelected] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const working = useRef(false);
  const resource = useSupportResource(
    `${status}:${offset}:${revision}`,
    (signal) => listLearning(status, offset, signal),
  );
  const detail = useSupportResource(`${selected}:${revision}`, (signal) =>
    selected ? getLearning(selected, signal) : Promise.resolve(null),
  );
  const changed = () => {
    setSelected("");
    setRevision((v) => v + 1);
  };
  async function detect() {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await detectLearning();
      setNotice(`${result.created} new suggestions detected.`);
      setRevision((v) => v + 1);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Unable to detect corrections.",
      );
    } finally {
      working.current = false;
      setBusy(false);
    }
  }
  return (
    <div className="space-y-5 p-5 md:p-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-slate-900">
          AI Learning Suggestions
        </h1>
        <button
          type="button"
          disabled={busy}
          onClick={detect}
          className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white"
        >
          {busy ? "Checking…" : "Detect repeated corrections"}
        </button>
      </div>
      <p className="text-sm text-slate-500">
        Matching staff corrections across at least three distinct cases become
        proposals. Knowledge changes require human approval.
      </p>
      <label className="text-xs font-semibold">
        Suggestion status
        <select
          aria-label="Suggestion status"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setOffset(0);
            setSelected("");
          }}
          className="ml-3 rounded-lg border border-slate-300 bg-white p-2"
        >
          <option>PENDING</option>
          <option>APPROVED</option>
          <option>REJECTED</option>
        </select>
      </label>
      {(error || resource.error || detail.error) && (
        <p role="alert" className="text-sm text-rose-700">
          {error || resource.error || detail.error}
        </p>
      )}
      {notice && (
        <p role="status" className="text-sm text-slate-600">
          {notice}
        </p>
      )}
      {resource.loading ? (
        <p role="status">Loading suggestions…</p>
      ) : (
        <div className="space-y-3">
          {resource.data?.suggestions.map((s) => (
            <button
              type="button"
              key={s.id}
              onClick={() => setSelected(s.id)}
              className="block w-full rounded-xl border border-slate-200 bg-white p-4 text-left"
            >
              <span className="block font-semibold">{s.suggested_problem}</span>
              <span className="text-xs text-slate-500">
                {s.evidence_count} cases · {s.status} · {supportLabel(s.port)}
              </span>
            </button>
          ))}
          {resource.data?.suggestions.length === 0 && (
            <p className="text-sm text-slate-500">
              No learning suggestions found.
            </p>
          )}
        </div>
      )}
      <div className="flex items-center gap-4 text-xs">
        <button
          type="button"
          disabled={offset === 0 || resource.loading}
          onClick={() => {
            setOffset((v) => Math.max(0, v - 20));
            setSelected("");
          }}
        >
          Previous
        </button>
        <span>{resource.data?.total || 0} suggestions</span>
        <button
          type="button"
          disabled={
            resource.loading || offset + 20 >= (resource.data?.total || 0)
          }
          onClick={() => {
            setOffset((v) => v + 20);
            setSelected("");
          }}
        >
          Next
        </button>
      </div>
      {selected && detail.loading && (
        <p role="status">Loading correction evidence…</p>
      )}
      {detail.data && (
        <Review
          key={`${selected}:${revision}`}
          detail={detail.data}
          onChanged={changed}
        />
      )}
    </div>
  );
}
