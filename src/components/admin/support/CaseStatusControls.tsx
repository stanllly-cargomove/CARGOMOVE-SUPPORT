import { useRef, useState } from "react";
import type { SupportCase } from "../../../types/support";
import {
  getDeliveryState,
  updateCaseStatus,
} from "../../../services/supportDelivery";
import { useSupportResource } from "../../../hooks/support/useSupportResource";
import { supportTime } from "../../../utils/support/status";
export function CaseStatusControls({
  item,
  onChanged,
}: {
  item: SupportCase;
  onChanged: () => void;
}) {
  const [reason, setReason] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const working = useRef(false);
  const resource = useSupportResource(
    `${item.id}:${item.updated_at}`,
    (signal) => getDeliveryState(item.id, signal),
  );
  const pending = resource.data?.deliveries.some(
    (d) => d.status === "IN_FLIGHT" || d.status === "UNKNOWN",
  );
  async function run(action: string) {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    setError("");
    try {
      await updateCaseStatus(item, action, reason);
      setReason("");
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to change status.");
    } finally {
      working.current = false;
      setBusy(false);
    }
  }
  const disabled =
    busy || !reason.trim() || !!pending || resource.loading || !!resource.error;
  return (
    <section
      aria-label="Case actions"
      className="rounded-xl border border-slate-200 bg-white p-4 space-y-3"
    >
      <label className="block text-xs font-semibold text-slate-600">
        Reason for case action
        <textarea
          aria-label="Case action reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={2000}
          rows={2}
          disabled={busy}
          className="mt-2 w-full rounded-lg border border-slate-300 p-2 text-sm font-normal"
        />
      </label>
      <div className="flex flex-wrap gap-2">
        {(item.status === "RESOLVED"
          ? ["REOPEN"]
          : ["ESCALATE", "RESOLVE"]
        ).map((action) => (
          <button
            type="button"
            key={action}
            disabled={
              disabled || (action === "ESCALATE" && item.status === "ESCALATED")
            }
            onClick={() => run(action)}
            className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold disabled:opacity-40"
          >
            {action === "REOPEN"
              ? "Reopen"
              : action === "RESOLVE"
                ? "Resolve"
                : "Escalate"}
          </button>
        ))}
      </div>
      {(error || resource.error) && (
        <p role="alert" className="text-sm text-rose-700">
          {error || resource.error}
        </p>
      )}
      {pending && (
        <p className="text-xs text-amber-700">
          Check the pending Gmail result before changing case status.
        </p>
      )}
      {!!resource.data?.events.length && (
        <details className="text-xs text-slate-600">
          <summary className="cursor-pointer font-semibold">
            Case action history
          </summary>
          {resource.data.events.map((e) => (
            <p className="mt-2 break-words" key={e.id}>
              {e.action} · {supportTime(e.created_at)} · {e.actor_id}
              <br />
              {e.reason}
            </p>
          ))}
        </details>
      )}
    </section>
  );
}
