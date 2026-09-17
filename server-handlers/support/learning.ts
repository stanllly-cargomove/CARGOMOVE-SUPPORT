import type { Request, Response } from "express";
import { bodyOf, configuredClient, noStore, requireAdmin } from "../_email.js";
import {
  supportRead,
  supportUuid,
  pageOffset,
  scalar,
  SupportQueryError,
} from "./queries.js";
import { knowledgeArticle, expectedVersion } from "../knowledge/validation.js";
export async function learningList(req: Request, res: Response) {
  return supportRead(req, res, "list_support_learning", () => {
    const status = scalar(req.query.status, "status") || "PENDING";
    if (!["PENDING", "APPROVED", "REJECTED"].includes(status))
      throw new SupportQueryError("Invalid suggestion status.");
    return { p_status: status, p_offset: pageOffset(req.query.offset) };
  });
}
export async function learningDetail(req: Request, res: Response) {
  return supportRead(req, res, "get_support_learning", () => ({
    p_id: supportUuid(req.query.id),
  }));
}
export async function learningWrite(req: Request, res: Response) {
  noStore(res);
  if (req.method !== "POST")
    return res.status(405).json({ error: "Method not allowed." });
  const admin = requireAdmin(req, res);
  if (!admin) return;
  const client = configuredClient(res);
  if (!client) return;
  try {
    const body = await bodyOf(req);
    let name: string, args: Record<string, unknown>;
    if (body.action === "DETECT") {
      name = "detect_support_learning";
      args = {};
    } else {
      if (body.action !== "APPROVE" && body.action !== "REJECT")
        throw new SupportQueryError("Invalid learning action.");
      name = "review_support_learning";
      args = {
        p_id: supportUuid(body.id),
        p_expected: expectedVersion(body.updated_at),
        p_approve: body.action === "APPROVE",
        p_article:
          body.action === "APPROVE" ? knowledgeArticle(body.article) : null,
        p_admin: admin.id,
      };
    }
    const result = await client.rpc<{ error?: string }>(name, args);
    if (result.error || !result.data)
      return res
        .status(503)
        .json({
          error:
            "Unable to access learning suggestions. Check the learning migration.",
        });
    if (result.data.error)
      return res
        .status(result.data.error === "NOT_FOUND" ? 404 : 409)
        .json({
          error:
            result.data.error === "DUPLICATE_CODE"
              ? "Knowledge code already exists."
              : result.data.error === "CONFLICT"
                ? "Suggestion or linked knowledge changed. Reload and review the current article."
                : "Unable to approve this suggestion.",
        });
    return res.json(result.data);
  } catch (e) {
    return res
      .status(e instanceof SupportQueryError ? 400 : 503)
      .json({
        error:
          e instanceof SupportQueryError
            ? e.message
            : "Unable to review learning suggestions.",
      });
  }
}
