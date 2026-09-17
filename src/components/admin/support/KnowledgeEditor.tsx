import React, { useState, useRef } from "react";
import { SUPPORT_CATEGORIES, SUPPORT_PORTS } from "../../../types/support";
import {
  KNOWLEDGE_SUBCATEGORIES,
  KNOWLEDGE_HIGH_RISK_SUBCATEGORIES,
} from "../../../types/knowledge";
import type {
  SupportKnowledge,
  KnowledgeArticleInput,
} from "../../../types/knowledge";
import { saveKnowledge } from "../../../services/knowledge";
import { supportLabel } from "../../../utils/support/status";
const inputClass =
  "mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900";
export function KnowledgeEditor({
  article,
  onSaved,
  onClose,
  initial,
  onSave,
  submitLabel,
}: {
  article: SupportKnowledge | null;
  initial?: KnowledgeArticleInput;
  onSave?: (input: KnowledgeArticleInput) => Promise<SupportKnowledge>;
  submitLabel?: string;
  onSaved: (article: SupportKnowledge) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<KnowledgeArticleInput>(
    () =>
      initial ||
      (article
        ? { ...article }
        : {
            knowledge_code: "",
            title: "",
            category: "OTHER",
            subcategory: null,
            port: "ALL",
            problem: "",
            possible_cause: null,
            resolution: "",
            suggested_action: null,
            keywords: [],
            requires_port_verification: false,
            human_review_required: true,
            ai_reply_allowed: false,
            active: false,
          }),
  );
  const [keywords, setKeywords] = useState(
    (initial?.keywords || article?.keywords)?.join(", ") || "",
  );
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const writing = useRef(false);
  const reviewRequired =
    draft.requires_port_verification ||
    KNOWLEDGE_HIGH_RISK_SUBCATEGORIES.includes(draft.subcategory || "");
  function change<K extends keyof KnowledgeArticleInput>(
    key: K,
    value: KnowledgeArticleInput[K],
  ) {
    setDraft((d) => {
      const next = { ...d, [key]: value };
      if (key === "category") next.subcategory = null;
      if (
        next.requires_port_verification ||
        KNOWLEDGE_HIGH_RISK_SUBCATEGORIES.includes(next.subcategory || "")
      )
        next.human_review_required = true;
      return next;
    });
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (writing.current) return;
    writing.current = true;
    setBusy(true);
    setError("");
    try {
      const saved = await (
        onSave ||
        ((input: KnowledgeArticleInput) =>
          saveKnowledge(input, article || undefined))
      )({
        ...draft,
        keywords: keywords
          .split(",")
          .map((k) => k.trim())
          .filter(Boolean),
      });
      onSaved(saved);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to save article.");
    } finally {
      writing.current = false;
      setBusy(false);
    }
  }
  return (
    <form
      onSubmit={submit}
      className="space-y-4 rounded-xl border border-slate-200 bg-white p-5"
      aria-label="Knowledge editor"
    >
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-bold text-slate-900">
          {article ? "Edit knowledge" : "Create knowledge"}
        </h2>
        <button
          type="button"
          disabled={busy}
          onClick={onClose}
          className="text-sm text-slate-500"
        >
          Close editor
        </button>
      </div>
      <p className="text-xs text-slate-500">
        Activate only after a staff member verifies the guidance. These articles
        do not verify live port or booking status.
      </p>
      {error && (
        <p role="alert" className="text-sm text-rose-700">
          {error}
        </p>
      )}
      <fieldset disabled={busy} className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          {(["knowledge_code", "title"] as const).map((key) => (
            <label key={key} className="text-xs font-semibold text-slate-600">
              {key === "knowledge_code" ? "Knowledge code" : "Title"}
              <input
                aria-label={
                  key === "knowledge_code" ? "Knowledge code" : "Title"
                }
                required
                maxLength={key === "knowledge_code" ? 80 : 200}
                value={draft[key]}
                onChange={(e) => change(key, e.target.value)}
                className={inputClass}
              />
            </label>
          ))}
          <label className="text-xs font-semibold text-slate-600">
            Category
            <select
              aria-label="Category"
              value={draft.category}
              onChange={(e) =>
                change(
                  "category",
                  e.target.value as KnowledgeArticleInput["category"],
                )
              }
              className={inputClass}
            >
              {SUPPORT_CATEGORIES.map((v) => (
                <option key={v} value={v}>
                  {supportLabel(v)}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs font-semibold text-slate-600">
            Subcategory
            <select
              aria-label="Subcategory"
              value={draft.subcategory || ""}
              onChange={(e) =>
                change(
                  "subcategory",
                  (e.target.value ||
                    null) as KnowledgeArticleInput["subcategory"],
                )
              }
              className={inputClass}
            >
              <option value="">General / unspecified</option>
              {KNOWLEDGE_SUBCATEGORIES[draft.category].map((v) => (
                <option key={v} value={v}>
                  {supportLabel(v)}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs font-semibold text-slate-600">
            Port
            <select
              aria-label="Port"
              value={draft.port}
              onChange={(e) =>
                change("port", e.target.value as KnowledgeArticleInput["port"])
              }
              className={inputClass}
            >
              {[...SUPPORT_PORTS, "ALL"].map((v) => (
                <option key={v} value={v}>
                  {supportLabel(v)}
                </option>
              ))}
            </select>
          </label>
        </div>
        {(
          [
            "problem",
            "possible_cause",
            "resolution",
            "suggested_action",
          ] as const
        ).map((key) => (
          <label
            key={key}
            className="block text-xs font-semibold text-slate-600"
          >
            {supportLabel(key)}
            <textarea
              aria-label={supportLabel(key)}
              rows={key === "resolution" ? 5 : 3}
              required={key === "problem" || key === "resolution"}
              maxLength={key === "suggested_action" ? 2000 : 8000}
              value={draft[key] || ""}
              onChange={(e) => change(key, e.target.value || null)}
              className={inputClass}
            />
          </label>
        ))}
        <label className="block text-xs font-semibold text-slate-600">
          Keywords (comma separated)
          <input
            value={keywords}
            onChange={(e) => setKeywords(e.target.value)}
            className={inputClass}
          />
        </label>
        <div className="space-y-2 text-sm text-slate-700">
          {(
            [
              ["requires_port_verification", "Requires port verification"],
              ["human_review_required", "Human review required"],
              ["ai_reply_allowed", "AI reply allowed"],
              ["active", "Active (approved for retrieval)"],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="flex items-start gap-2">
              <input
                type="checkbox"
                checked={draft[key]}
                disabled={key === "human_review_required" && reviewRequired}
                onChange={(e) => change(key, e.target.checked)}
                className="mt-1"
              />
              {label}
            </label>
          ))}
        </div>
        {reviewRequired && (
          <p className="text-xs text-amber-700">
            Human review is required for this operational scope.
          </p>
        )}
        <button
          type="submit"
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white"
        >
          {busy
            ? "Saving…"
            : submitLabel
              ? submitLabel
              : draft.active
                ? "Approve and save article"
                : "Save draft"}
        </button>
      </fieldset>
    </form>
  );
}
