import type { Request, Response } from "express";
import { bodyOf, configuredClient, noStore, requireAdmin } from "../_email.js";
import { supportRead, supportUuid, SupportQueryError } from "./queries.js";
import { expectedVersion } from "../knowledge/validation.js";
import { SUPPORT_CATEGORIES, SUPPORT_PORTS } from "../../src/types/support.js";
import {
  KNOWLEDGE_SUBCATEGORIES,
  KNOWLEDGE_HIGH_RISK_SUBCATEGORIES,
} from "../../src/types/knowledge.js";
import type {
  AutomationPolicy,
  AutomationRuleInput,
} from "../../src/types/supportAutomation.js";
import analyze from "../ai/analyze.js";
import { replyGenerate } from "../ai/reply-handlers.js";
import { deliveryAutoAck } from "./delivery.js";
export function automationRule(value: unknown): AutomationRuleInput {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new SupportQueryError("Invalid automation rule.");
  const r = value as AutomationRuleInput;
  if (
    !SUPPORT_CATEGORIES.includes(r.category) ||
    ![...SUPPORT_PORTS, "ALL"].includes(r.port) ||
    (r.subcategory !== null &&
      !KNOWLEDGE_SUBCATEGORIES[r.category].includes(r.subcategory))
  )
    throw new SupportQueryError("Invalid rule scope.");
  for (const key of [
    "ai_analysis_enabled",
    "ai_draft_enabled",
    "auto_send_enabled",
    "always_require_human",
    "active",
  ] as const)
    if (typeof r[key] !== "boolean")
      throw new SupportQueryError("All rule switches are required.");
  if (
    typeof r.minimum_confidence !== "number" ||
    !Number.isFinite(r.minimum_confidence) ||
    r.minimum_confidence < 0 ||
    r.minimum_confidence > 1
  )
    throw new SupportQueryError("Confidence must be between 0 and 1.");
  if (
    !r.always_require_human &&
    (!r.subcategory ||
      !["DRIVER", "VEHICLE", "BOOKING", "ACCOUNT", "REGISTRATION"].includes(
        r.category,
      ) ||
      KNOWLEDGE_HIGH_RISK_SUBCATEGORIES.includes(r.subcategory))
  )
    throw new SupportQueryError(
      "General and high-risk scopes must always require human review.",
    );
  if (
    r.auto_send_enabled &&
    (!r.active ||
      !r.ai_analysis_enabled ||
      !r.ai_draft_enabled ||
      r.always_require_human ||
      r.minimum_confidence < 0.9 ||
      !r.subcategory ||
      !["DRIVER", "VEHICLE", "BOOKING", "ACCOUNT", "REGISTRATION"].includes(
        r.category,
      ) ||
      KNOWLEDGE_HIGH_RISK_SUBCATEGORIES.includes(r.subcategory))
  )
    throw new SupportQueryError(
      "Auto acknowledgements require an active specific low-risk rule, analysis and drafting enabled, confidence at least 90%, and human-only off.",
    );
  return Object.fromEntries(
    [
      "category",
      "subcategory",
      "port",
      "ai_analysis_enabled",
      "ai_draft_enabled",
      "auto_send_enabled",
      "minimum_confidence",
      "always_require_human",
      "active",
    ].map((key) => [key, (r as unknown as Record<string, unknown>)[key]]),
  ) as unknown as AutomationRuleInput;
}
export async function automationRules(req: Request, res: Response) {
  if (req.method === "GET") {
    noStore(res);
    if (!requireAdmin(req, res)) return;
    const client = configuredClient(res);
    if (!client) return;
    const result = await client.rpc<{ rules: unknown[] }>(
      "list_support_automation",
      {},
    );
    if (result.error || !result.data)
      return res.status(503).json({
        error: "Unable to load automation rules. Check the migration.",
      });
    return res.json({
      ...result.data,
      server_auto_send_enabled:
        process.env.SUPPORT_AUTO_SEND_ENABLED === "true",
    });
  }
  noStore(res);
  if (req.method !== "POST" && req.method !== "PUT")
    return res.status(405).json({ error: "Method not allowed." });
  const admin = requireAdmin(req, res);
  if (!admin) return;
  const client = configuredClient(res);
  if (!client) return;
  try {
    const body = await bodyOf(req);
    const result = await client.rpc<{ error?: string }>(
      "save_support_automation",
      {
        p_id: req.method === "PUT" ? supportUuid(body.id) : null,
        p_expected:
          req.method === "PUT" ? expectedVersion(body.updated_at) : null,
        p_rule: automationRule(body.rule),
        p_admin: admin.id,
      },
    );
    if (result.error || !result.data)
      return res.status(503).json({
        error: "Unable to save rules. Check the automation migration.",
      });
    if (result.data.error)
      return res.status(409).json({
        error:
          result.data.error === "DUPLICATE_SCOPE"
            ? "This rule scope already exists."
            : "The rule changed. Reload before saving.",
      });
    return res.json(result.data);
  } catch (e) {
    return res.status(e instanceof SupportQueryError ? 400 : 503).json({
      error:
        e instanceof SupportQueryError
          ? e.message
          : "Unable to save automation rules.",
    });
  }
}
async function invoke(
  handler: (req: Request, res: Response) => unknown,
  req: Request,
  body: unknown,
) {
  let status = 200,
    result: any;
  const response = {
    setHeader() {},
    status(n: number) {
      status = n;
      return this;
    },
    json(value: unknown) {
      result = value;
      return this;
    },
  };
  await handler(
    { headers: req.headers, query: req.query, method: "POST", body } as Request,
    response as unknown as Response,
  );
  return { status, result };
}
export async function automationRun(req: Request, res: Response) {
  const started = Date.now();
  noStore(res);
  if (req.method !== "POST")
    return res.status(405).json({ error: "Method not allowed." });
  if (!requireAdmin(req, res)) return;
  const client = configuredClient(res);
  if (!client) return;
  try {
    const body = await bodyOf(req),
      id = supportUuid(body.case_id);
    const policy = async () => {
      const result = await client.rpc<AutomationPolicy>(
        "support_automation_policy",
        { p_case: id },
      );
      if (result.error || !result.data)
        throw new Error("Unable to evaluate automation. Check the migration.");
      return result.data;
    };
    const pending = await client.rpc<{ deliveries: Array<{ status: string }> }>(
      "support_delivery_state",
      { p_case: id },
    );
    if (pending.error || !pending.data)
      throw new Error("Unable to check delivery history.");
    if (
      pending.data.deliveries.some((d) =>
        ["IN_FLIGHT", "UNKNOWN"].includes(d.status),
      )
    )
      return res
        .status(409)
        .json({ error: "A Gmail action is pending. Check its result first." });
    let p = await policy();
    if (
      !p.rule?.active ||
      !p.rule.ai_analysis_enabled ||
      ["RESOLVED", "ESCALATED", "WAITING_CUSTOMER"].includes(p.status)
    )
      return res.status(409).json({
        error: "No active analysis rule permits automation for this case.",
      });
    const analyzed = await invoke(analyze, req, { case_id: id });
    if (analyzed.status !== 200)
      return res.status(analyzed.status).json(analyzed.result);
    p = await policy();
    if (!p.rule?.active || !p.rule.ai_draft_enabled)
      return res.json({
        message:
          "Analysis saved. The resulting scope has no active draft rule.",
      });
    if (analyzed.result.interaction.confidence < p.rule.minimum_confidence)
      return res.json({
        message:
          "Analysis saved. Confidence is below the rule threshold; staff review is required.",
      });
    const auto =
      p.can_auto_ack && process.env.SUPPORT_AUTO_SEND_ENABLED === "true";
    if (auto && Date.now() - started > 10000)
      return res.json({
        message:
          "Analysis saved. Run configured automation again to complete the acknowledgement within the request time limit.",
      });
    let drafted = await invoke(replyGenerate, req, {
      case_id: id,
      template_id: auto ? "ACKNOWLEDGE" : "KNOWLEDGE",
    });
    if (drafted.result?.code === "NO_KNOWLEDGE")
      drafted = await invoke(replyGenerate, req, {
        case_id: id,
        template_id: "ACKNOWLEDGE",
      });
    if (drafted.status !== 200)
      return res.status(drafted.status).json(drafted.result);
    if (!auto)
      return res.json({
        message:
          "Analysis and draft saved. Human approval is required before sending.",
      });
    const d = drafted.result.draft;
    const delivered = await invoke(
      (request, response) =>
        deliveryAutoAck(request, response, {
          ruleId: p.rule!.id,
          ruleVersion: p.rule!.updated_at,
        }),
      req,
      { case_id: id, draft_id: d.id, updated_at: d.updated_at, kind: "SEND" },
    );
    if (delivered.status !== 200)
      return res.status(delivered.status).json(delivered.result);
    return res.json({
      message: "Fixed acknowledgement sent under the configured rule.",
      operation: delivered.result.operation,
    });
  } catch (e) {
    return res.status(e instanceof SupportQueryError ? 400 : 503).json({
      error:
        e instanceof SupportQueryError
          ? e.message
          : "Automation could not finish. Refresh analysis, draft and delivery history before retrying.",
    });
  }
}
