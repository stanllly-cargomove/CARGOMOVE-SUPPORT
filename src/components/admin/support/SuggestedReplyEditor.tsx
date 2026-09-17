import { ReplyDeliveryControls } from "./ReplyDeliveryControls";
import React, { useEffect, useRef, useState } from "react";
import {
  getSupportReply,
  generateSupportReply,
  editSupportReply,
} from "../../../services/supportReply";
import { useSupportResource } from "../../../hooks/support/useSupportResource";
import type {
  ReplyTemplate,
  SupportReplyDraft,
} from "../../../types/supportAI";
function DraftEditor({
  draft,
  onSaved,
  onDirty,
  onDelivered,
}: {
  draft: SupportReplyDraft;
  onSaved: () => void;
  onDirty: (dirty: boolean) => void;
  onDelivered: () => void;
}) {
  const [text, setText] = useState(draft.edited_reply),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [saved, setSaved] = useState(false);
  const working = useRef(false);
  async function save() {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    setError("");
    try {
      await editSupportReply(draft, text);
      setSaved(true);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to save edits.");
    } finally {
      working.current = false;
      setBusy(false);
    }
  }
  const changed = text !== draft.edited_reply;
  useEffect(() => {
    onDirty(changed);
    return () => onDirty(false);
  }, [changed, onDirty]);
  useEffect(() => {
    setSaved(false);
  }, [text]);
  return (
    <div className="mt-4 space-y-3">
      {draft.stale && (
        <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
          This draft uses changed conversation, analysis or knowledge. Refresh
          the analysis and generate a current draft before continuing.
        </p>
      )}
      <p className="text-xs text-slate-500">
        {Math.round(draft.interaction.confidence * 100)}% classification
        confidence · Human approval required · {draft.interaction.model}
      </p>
      <label className="block text-xs font-semibold text-slate-600">
        Suggested reply
        <textarea
          aria-label="Suggested reply"
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={6000}
          rows={9}
          disabled={busy || draft.stale}
          className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-normal text-slate-900"
        />
      </label>
      {error && (
        <p role="alert" className="text-sm text-rose-700">
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={busy || draft.stale || !changed || !text.trim()}
          onClick={save}
          className="rounded-lg border border-blue-300 px-3 py-2 text-xs font-semibold text-blue-700 disabled:opacity-40"
        >
          {busy ? "Saving…" : "Save draft edits"}
        </button>
        <button
          type="button"
          disabled={busy || !changed}
          onClick={() => setText(draft.edited_reply)}
          className="text-xs font-semibold text-slate-500"
        >
          Discard local edits
        </button>
        <span className="text-xs text-slate-500">
          {changed
            ? "Unsaved edits"
            : saved
              ? "Draft edits saved"
              : "Saved draft"}{" "}
          · {text.length}/6000
        </span>
      </div>
      <ReplyDeliveryControls
        draft={draft}
        disabled={changed || busy}
        onDelivered={onDelivered}
      />
      <details className="text-xs text-slate-500">
        <summary className="cursor-pointer font-semibold">
          Original generated reply
        </summary>
        <p className="mt-2 whitespace-pre-wrap break-words">
          {draft.interaction.generated_reply}
        </p>
      </details>
      <div className="border-t border-slate-200 pt-3">
        <h4 className="text-xs font-bold text-slate-700">
          Knowledge used in this draft
        </h4>
        {draft.knowledge.length ? (
          draft.knowledge.map((k) => (
            <details
              key={k.id}
              className="mt-2 rounded-lg border border-slate-200 p-2"
            >
              <summary className="cursor-pointer break-words text-xs font-semibold text-slate-700">
                {k.knowledge_code} · {k.title}
              </summary>
              <p className="mt-2 whitespace-pre-wrap break-words text-sm text-slate-700">
                {k.resolution}
              </p>
              <p className="mt-2 text-xs text-slate-500">
                {k.active ? "Active" : "Inactive"} ·{" "}
                {k.ai_reply_allowed
                  ? "AI replies allowed"
                  : "AI replies disabled"}{" "}
                ·{" "}
                {k.requires_port_verification
                  ? "Port verification required"
                  : "Staff review required"}
              </p>
            </details>
          ))
        ) : (
          <p className="mt-2 text-xs text-slate-500">
            Acknowledgement/information-request template; no operational
            knowledge was used.
          </p>
        )}
      </div>
    </div>
  );
}
export function SuggestedReplyEditor({
  caseId,
  analysisId,
  blocked,
  onDelivered,
}: {
  caseId: string;
  analysisId: string;
  blocked: boolean;
  onDelivered: () => void;
}) {
  const [template, setTemplate] = useState<ReplyTemplate>("KNOWLEDGE"),
    [revision, setRevision] = useState(0),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const working = useRef(false);
  const [dirty, setDirty] = useState(false),
    [selectedDraft, setSelectedDraft] = useState<string>();
  const resource = useSupportResource(
    `${caseId}:${analysisId}:${selectedDraft || "latest"}:${revision}`,
    (signal) => getSupportReply(caseId, signal, selectedDraft),
  );
  async function generate() {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    setError("");
    try {
      const generated = await generateSupportReply(caseId, template);
      setSelectedDraft(generated.draft?.id);
      setRevision((v) => v + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to generate reply.");
    } finally {
      working.current = false;
      setBusy(false);
    }
  }
  return (
    <section
      aria-label="Suggested reply editor"
      className="mt-5 border-t border-slate-200 pt-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-bold text-slate-900">AI suggested reply</h3>
        <button
          type="button"
          onClick={() => setRevision((v) => v + 1)}
          disabled={busy || dirty}
          className="text-xs font-semibold text-blue-600"
        >
          Reload saved draft
        </button>
      </div>
      <p className="mt-2 text-xs text-slate-500">
        Review guidance and wording, then save edits before creating a Gmail
        draft or approving a send.
      </p>
      <div className="mt-3 flex flex-wrap items-end gap-2">
        <label className="text-xs font-semibold text-slate-600">
          Reply template
          <select
            aria-label="Reply template"
            value={template}
            onChange={(e) => setTemplate(e.target.value as ReplyTemplate)}
            disabled={busy || dirty}
            className="mt-1 block rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
          >
            <option value="KNOWLEDGE">Approved knowledge guidance</option>
            <option value="ACKNOWLEDGE">Acknowledge receipt</option>
            <option value="REQUEST_DETAILS">Request more information</option>
          </select>
        </label>
        <button
          type="button"
          disabled={busy || blocked || dirty}
          onClick={generate}
          className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-40"
        >
          {busy ? "Generating…" : "Generate suggested reply"}
        </button>
      </div>
      {dirty && (
        <p className="mt-2 text-xs text-amber-700">
          Save or discard local edits before generating or reloading a draft.
        </p>
      )}
      {blocked && (
        <p className="mt-2 text-xs text-amber-700">
          A current analysis and an open case are required.
        </p>
      )}
      {(error || resource.error) && (
        <p role="alert" className="mt-3 text-sm text-rose-700">
          {error || resource.error}
        </p>
      )}
      {resource.loading ? (
        <p role="status" className="mt-3 text-sm text-slate-500">
          Loading saved reply…
        </p>
      ) : resource.data?.draft ? (
        <DraftEditor
          key={`${resource.data.draft.id}:${resource.data.draft.updated_at}`}
          draft={resource.data.draft}
          onDirty={setDirty}
          onDelivered={onDelivered}
          onSaved={() => setRevision((v) => v + 1)}
        />
      ) : (
        !resource.error && (
          <p className="mt-3 text-sm text-slate-500">
            No suggested reply has been generated.
          </p>
        )
      )}
    </section>
  );
}
