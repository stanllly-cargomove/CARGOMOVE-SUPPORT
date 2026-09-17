import { useRef, useState } from "react";
import type { SupportReplyDraft } from "../../../types/supportAI";
import {
  getDeliveryState,
  deliverReply,
  checkDelivery,
} from "../../../services/supportDelivery";
import { connectGmail } from "../../../services/email";
import { useSupportResource } from "../../../hooks/support/useSupportResource";
import { supportTime } from "../../../utils/support/status";
export function ReplyDeliveryControls({
  draft,
  disabled,
  onDelivered,
}: {
  draft: SupportReplyDraft;
  disabled: boolean;
  onDelivered: () => void;
}) {
  const [revision, setRevision] = useState(0),
    [reviewed, setReviewed] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const working = useRef(false);
  const resource = useSupportResource(
    `${draft.case_id}:${revision}`,
    (signal) => getDeliveryState(draft.case_id, signal),
  );
  const pending = resource.data?.deliveries.find(
    (d) => d.status === "IN_FLIGHT" || d.status === "UNKNOWN",
  );
  const sent = resource.data?.deliveries.find(
    (d) =>
      d.kind === "SEND" &&
      d.status === "DONE" &&
      d.context_fingerprint === draft.context_fingerprint,
  );
  const savedDraft = resource.data?.deliveries.find(
    (d) =>
      d.kind === "GMAIL_DRAFT" &&
      d.status === "DONE" &&
      d.draft_id === draft.id &&
      d.draft_version === draft.updated_at,
  );
  const blocked =
    disabled ||
    draft.stale ||
    busy ||
    !!pending ||
    !!sent ||
    resource.loading ||
    !!resource.error;
  async function run(kind: "SEND" | "GMAIL_DRAFT" | "CHECK") {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    setError("");
    try {
      if (kind === "CHECK" && pending) await checkDelivery(pending);
      else if (kind !== "CHECK") await deliverReply(draft, kind, reviewed);
      setReviewed(false);
      if (kind === "SEND" || (kind === "CHECK" && pending?.kind === "SEND"))
        onDelivered();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to complete action.");
    } finally {
      working.current = false;
      setBusy(false);
      setRevision((v) => v + 1);
    }
  }
  return (
    <section
      aria-label="Reply delivery"
      className="space-y-3 rounded-lg border border-slate-200 p-3"
    >
      <p className="break-words text-sm text-slate-700">
        Recipient: <strong>{resource.data?.recipient || "Loading…"}</strong>
      </p>
      <label className="flex gap-2 text-xs text-slate-700">
        <input
          type="checkbox"
          checked={reviewed && !disabled}
          disabled={blocked}
          onChange={(e) => setReviewed(e.target.checked)}
        />
        I reviewed the saved reply, recipient and any required port
        verification.
      </label>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={blocked || !!savedDraft}
          onClick={() => run("GMAIL_DRAFT")}
          className="rounded-lg border border-blue-300 px-3 py-2 text-xs font-semibold text-blue-700 disabled:opacity-40"
        >
          {savedDraft ? "Gmail draft saved" : "Create Gmail draft"}
        </button>
        <button
          type="button"
          disabled={blocked || !reviewed}
          onClick={() => run("SEND")}
          className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-40"
        >
          {busy ? "Working…" : "Approve & send"}
        </button>
      </div>
      {disabled && (
        <p className="text-xs text-amber-700">
          Save or discard local edits before delivery.
        </p>
      )}
      {pending && (
        <div className="text-xs text-amber-800">
          <p>
            A Gmail action is pending or uncertain. Further replies are blocked.
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={() => run("CHECK")}
            className="mt-2 font-semibold underline"
          >
            Check Gmail result
          </button>
        </div>
      )}
      {(error || resource.error) && (
        <p role="alert" className="text-sm text-rose-700">
          {error || resource.error}
        </p>
      )}
      {error.includes("gmail.compose") && (
        <button
          type="button"
          onClick={() => connectGmail().catch((e) => setError(e.message))}
          className="text-xs font-semibold text-blue-600 underline"
        >
          Reconnect Gmail for draft permission
        </button>
      )}
      {sent && (
        <details className="text-xs text-emerald-800">
          <summary className="cursor-pointer font-semibold">
            Reply sent · {supportTime(sent.completed_at)}
          </summary>
          <p className="mt-2">
            {sent.approval_mode === "AUTOMATIC_ACK"
              ? `Automatic acknowledgement · Rule ${sent.automation_rule_id}`
              : `Reviewed by ${sent.requested_by}`}{" "}
            · {supportTime(sent.created_at)}
          </p>
          <p className="mt-2 whitespace-pre-wrap break-words">
            {sent.reply_text}
          </p>
          <p className="mt-2">
            {sent.generated_reply === sent.reply_text
              ? "Sent as generated"
              : "Staff edited the generated reply"}
          </p>
          <p className="mt-2 font-semibold">Original generated text</p>
          <p className="mt-2 whitespace-pre-wrap break-words">
            {sent.generated_reply}
          </p>
        </details>
      )}
    </section>
  );
}
