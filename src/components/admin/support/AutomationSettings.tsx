import toast from "react-hot-toast";
import { useRef, useState } from "react";
import {
  getAutomationRules,
  saveAutomationRule,
  runAutomation,
} from "../../../services/supportAutomation";
import type {
  AutomationRule,
  AutomationRuleInput,
} from "../../../types/supportAutomation";
import { SUPPORT_CATEGORIES, SUPPORT_PORTS } from "../../../types/support";
import { KNOWLEDGE_SUBCATEGORIES } from "../../../types/knowledge";
import { useSupportResource } from "../../../hooks/support/useSupportResource";
import { supportLabel } from "../../../utils/support/status";
function RuleEditor({
  existing,
  onSaved,
  onClose,
}: {
  existing: AutomationRule | null;
  onSaved: () => void;
  onClose: () => void;
}) {
  const [rule, setRule] = useState<AutomationRuleInput>(
    existing || {
      category: "OTHER",
      subcategory: null,
      port: "ALL",
      ai_analysis_enabled: true,
      ai_draft_enabled: true,
      auto_send_enabled: false,
      minimum_confidence: 0.9,
      always_require_human: true,
      active: false,
    },
  );
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const working = useRef(false);
  return (
    <form
      aria-label="Automation rule editor"
      onSubmit={async (e) => {
        e.preventDefault();
        if (working.current) return;
        working.current = true;
        setBusy(true);
        setError("");
        try {
          await saveAutomationRule(rule, existing || undefined);
          onSaved();
        } catch (e) {
          setError(e instanceof Error ? e.message : "Unable to save.");
        } finally {
          working.current = false;
          setBusy(false);
        }
      }}
      className="space-y-4 rounded-xl border border-slate-200 bg-white p-5"
    >
      <h2 className="font-bold">{existing ? "Edit rule" : "Create rule"}</h2>
      <fieldset disabled={busy} className="space-y-4">
        <div className="flex flex-wrap gap-3">
          <label className="text-xs font-semibold">
            Category
            <select
              aria-label="Rule category"
              value={rule.category}
              onChange={(e) =>
                setRule((r) => ({
                  ...r,
                  category: e.target.value as AutomationRuleInput["category"],
                  subcategory: null,
                  auto_send_enabled: false,
                  always_require_human: true,
                }))
              }
              className="mt-1 block rounded border p-2"
            >
              {SUPPORT_CATEGORIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          <label className="text-xs font-semibold">
            Subcategory
            <select
              aria-label="Rule subcategory"
              value={rule.subcategory || ""}
              onChange={(e) =>
                setRule((r) => ({
                  ...r,
                  subcategory: (e.target.value ||
                    null) as AutomationRuleInput["subcategory"],
                  auto_send_enabled: false,
                  always_require_human: true,
                }))
              }
              className="mt-1 block max-w-full rounded border p-2"
            >
              <option value="">General</option>
              {KNOWLEDGE_SUBCATEGORIES[rule.category].map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          <label className="text-xs font-semibold">
            Port
            <select
              aria-label="Rule port"
              value={rule.port}
              onChange={(e) =>
                setRule((r) => ({
                  ...r,
                  port: e.target.value as AutomationRuleInput["port"],
                }))
              }
              className="mt-1 block rounded border p-2"
            >
              {[...SUPPORT_PORTS, "ALL"].map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
          </label>
        </div>
        {(
          [
            "active",
            "ai_analysis_enabled",
            "ai_draft_enabled",
            "always_require_human",
            "auto_send_enabled",
          ] as const
        ).map((key) => (
          <label key={key} className="flex gap-2 text-sm">
            <input
              type="checkbox"
              checked={rule[key]}
              onChange={(e) =>
                setRule((r) => ({
                  ...r,
                  [key]: e.target.checked,
                  ...(key !== "auto_send_enabled" &&
                  ((key === "always_require_human" && e.target.checked) ||
                    (key !== "always_require_human" && !e.target.checked))
                    ? { auto_send_enabled: false }
                    : {}),
                }))
              }
            />
            {
              {
                active: "Active",
                ai_analysis_enabled: "AI analysis",
                ai_draft_enabled: "AI draft",
                always_require_human: "Always require human",
                auto_send_enabled: "Auto-send fixed acknowledgement",
              }[key]
            }
          </label>
        ))}
        <label className="block text-xs font-semibold">
          Minimum confidence (%)
          <input
            aria-label="Minimum confidence (%)"
            type="number"
            min={0}
            max={100}
            step={1}
            value={Math.round(rule.minimum_confidence * 100)}
            onChange={(e) =>
              setRule((r) => ({
                ...r,
                minimum_confidence: Number(e.target.value) / 100,
              }))
            }
            className="ml-3 w-20 rounded border p-2"
          />
        </label>
        <p className="text-xs text-amber-800">
          Automatic sends are fixed acknowledgements only. They also require the
          server switch, a specific low-risk scope, at least 90% confidence, and
          no required knowledge verification. Operational guidance always needs
          staff approval.
        </p>
        <div className="flex gap-3">
          <button
            type="submit"
            className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white"
          >
            {busy ? "Saving…" : "Save automation rule"}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="text-xs font-semibold"
          >
            Cancel rule editing
          </button>
        </div>
      </fieldset>
      {error && (
        <p role="alert" className="text-sm text-rose-700">
          {error}
        </p>
      )}
    </form>
  );
}
export function AutomationSettings() {
  const [revision, setRevision] = useState(0),
    [editing, setEditing] = useState(false),
    [selected, setSelected] = useState<AutomationRule | null>(null);
  const resource = useSupportResource(`${revision}`, getAutomationRules);
  return (
    <div className="space-y-5 p-5 md:p-8">
      <div className="flex flex-wrap justify-between gap-3">
        <h1 className="text-2xl font-bold">Support Automation</h1>
        <button
          type="button"
          onClick={() => {
            setSelected(null);
            setEditing(true);
          }}
          className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white"
        >
          Create automation rule
        </button>
      </div>
      <p className="text-sm text-slate-500">
        Rules run only when staff select Run configured automation on a case. No
        background schedule is enabled. Auto-send is off by default and limited
        to fixed acknowledgements.
      </p>
      <button
        type="button"
        onClick={() => setRevision((v) => v + 1)}
        className="text-xs font-semibold text-blue-600"
      >
        Reload automation rules
      </button>
      {resource.data && (
        <p className="text-sm font-semibold text-slate-600">
          Server auto-send switch:{" "}
          {resource.data.server_auto_send_enabled ? "ON" : "OFF"}
        </p>
      )}
      {resource.error && (
        <p role="alert" className="text-sm text-rose-700">
          {resource.error}
        </p>
      )}
      {resource.loading ? (
        <p role="status">Loading automation rules…</p>
      ) : (
        <div className="space-y-3">
          {resource.data?.rules.map((r) => (
            <article
              key={r.id}
              className="rounded-xl border border-slate-200 bg-white p-4"
            >
              <h2 className="font-semibold">
                {supportLabel(r.category)} ·{" "}
                {supportLabel(r.subcategory || "GENERAL")} ·{" "}
                {supportLabel(r.port)}
              </h2>
              <p className="mt-2 text-xs text-slate-500">
                {r.active ? "Active" : "Inactive"} · Analysis{" "}
                {r.ai_analysis_enabled ? "ON" : "OFF"} · Draft{" "}
                {r.ai_draft_enabled ? "ON" : "OFF"} · Auto acknowledgement{" "}
                {r.auto_send_enabled ? "ON" : "OFF"} · Minimum{" "}
                {Math.round(r.minimum_confidence * 100)}% · Human review{" "}
                {r.always_require_human ? "ON" : "OFF"}
              </p>
              <button
                type="button"
                onClick={() => {
                  setSelected(r);
                  setEditing(true);
                }}
                className="mt-3 text-xs font-semibold text-blue-600"
              >
                Edit rule
              </button>
            </article>
          ))}
          {resource.data?.rules.length === 0 && (
            <p className="text-sm text-slate-500">
              No automation rules configured.
            </p>
          )}
        </div>
      )}
      {editing && (
        <RuleEditor
          key={selected?.id || "new"}
          existing={selected}
          onSaved={() => {
            setEditing(false);
            setRevision((v) => v + 1);
          }}
          onClose={() => setEditing(false)}
        />
      )}
    </div>
  );
}
export function AutomationCaseControl({
  caseId,
  onChanged,
}: {
  caseId: string;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const working = useRef(false);
  return (
    <div className="space-y-2">
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          if (working.current) return;
          working.current = true;
          setBusy(true);
          setError("");
          try {
            const result = await runAutomation(caseId);
            toast.success(result.message);
            onChanged();
          } catch (e) {
            setError(e instanceof Error ? e.message : "Automation failed.");
          } finally {
            working.current = false;
            setBusy(false);
          }
        }}
        className="rounded-lg border border-blue-300 bg-white px-3 py-2 text-xs font-semibold text-blue-700"
      >
        {busy ? "Running automation…" : "Run configured automation"}
      </button>
      {error && (
        <p role="alert" className="text-sm text-rose-700">
          {error}
        </p>
      )}
    </div>
  );
}
