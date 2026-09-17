import { decodeHeader } from "../gmail/parse.js";
import { randomUUID } from "node:crypto";
import type { Request, Response } from "express";
import { bodyOf, configuredClient, noStore, requireAdmin } from "../_email.js";
import { supportRead, supportUuid, SupportQueryError } from "./queries.js";
import { expectedVersion } from "../knowledge/validation.js";
import {
  gmailReader,
  inboxAccessToken,
  inboxConnection,
  InboxError,
  validGmailId,
  type ServerClient,
  GMAIL_COMPOSE_SCOPE,
} from "../gmail/client.js";
import {
  gmailWrite,
  header,
  mailbox,
  preflight,
  rawReply,
  WriteError,
  type MetadataMessage,
} from "./delivery-gmail.js";
import type { SupportCase, SupportMessage } from "../../src/types/support.js";
import type { StoredReply } from "../../src/types/supportAI.js";
import type {
  Delivery,
  DeliveryState,
} from "../../src/types/supportDelivery.js";
const messages: Record<string, string> = {
  PENDING:
    "A Gmail action is pending or uncertain. Check Gmail result before continuing.",
  ALREADY_SENT: "This conversation version already has a sent reply.",
  STALE: "This draft is stale. Refresh the analysis and reply.",
  CONFLICT: "The case or draft changed. Reload before continuing.",
  MAILBOX_CHANGED: "The Gmail mailbox changed. Reconnect and sync.",
  INVALID_ACTION: "This case action is unavailable.",
  NOT_FOUND: "Case or draft not found.",
};
async function rpc<T>(
  client: ServerClient,
  name: string,
  args: Record<string, unknown>,
): Promise<T> {
  const result = await client.rpc<T & { error?: string }>(name, args);
  if (result.error || !result.data)
    throw new InboxError(
      "DATABASE_UNAVAILABLE",
      "Unable to record the support action. Check the delivery migration.",
      503,
    );
  if (result.data.error)
    throw new InboxError(
      result.data.error,
      messages[result.data.error] || "Unable to complete this support action.",
      409,
    );
  return result.data;
}
function respond(error: unknown, res: Response) {
  return res
    .status(
      error instanceof InboxError
        ? error.status
        : error instanceof SupportQueryError
          ? 400
          : 503,
    )
    .json({
      code: error instanceof InboxError ? error.code : "DELIVERY_FAILED",
      error:
        error instanceof InboxError || error instanceof SupportQueryError
          ? error.message
          : "Unable to complete the support action. Reload the delivery history before retrying.",
    });
}
export function deliveryRead(req: Request, res: Response) {
  return supportRead(req, res, "support_delivery_state", () => ({
    p_case: supportUuid(req.query.id),
  }));
}
export function deliveryWrite(req: Request, res: Response) {
  return performDelivery(req, res);
}
export function deliveryAutoAck(
  req: Request,
  res: Response,
  automation: { ruleId: string; ruleVersion: string },
) {
  return performDelivery(req, res, automation);
}
async function performDelivery(
  req: Request,
  res: Response,
  automation?: { ruleId: string; ruleVersion: string },
) {
  noStore(res);
  if (req.method !== "POST")
    return res.status(405).json({ error: "Method not allowed." });
  const admin = requireAdmin(req, res);
  if (!admin) return;
  const client = configuredClient(res);
  if (!client) return;
  let operation: Delivery | undefined;
  try {
    const body = await bodyOf(req);
    const caseId = supportUuid(body.case_id),
      draftId = supportUuid(body.draft_id);
    const kind = body.kind;
    if (kind !== "SEND" && kind !== "GMAIL_DRAFT")
      throw new SupportQueryError("Invalid delivery action.");
    if (kind === "SEND" && !automation && body.reviewed !== true)
      throw new SupportQueryError(
        "Confirm review of the reply, recipient and required port verification before sending.",
      );
    if (automation && process.env.SUPPORT_AUTO_SEND_ENABLED !== "true")
      throw new SupportQueryError(
        "Automatic sending is disabled on this server.",
      );
    const expected = expectedVersion(body.updated_at);
    const state = await rpc<DeliveryState>(client, "support_delivery_state", {
      p_case: caseId,
    });
    // Return a durable receipt before reading Gmail; double clicks never repeat writes.
    const prior = state.deliveries.find(
      (d) =>
        d.draft_id === draftId &&
        d.draft_version === expected &&
        d.kind === kind &&
        d.status !== "FAILED",
    );
    if (prior) {
      if (prior.status !== "DONE")
        throw new InboxError("PENDING", messages.PENDING, 409);
      return res.json({ operation: prior, cached: true });
    }
    if (
      state.deliveries.some(
        (d) => d.status === "IN_FLIGHT" || d.status === "UNKNOWN",
      )
    )
      throw new InboxError("PENDING", messages.PENDING, 409);
    const stored = await rpc<StoredReply>(client, "get_support_reply", {
      p_case: caseId,
      p_draft: draftId,
    });
    if (!stored.draft || stored.draft.case_id !== caseId)
      throw new InboxError("NOT_FOUND", messages.NOT_FOUND, 404);
    if (stored.draft.stale) throw new InboxError("STALE", messages.STALE, 409);
    const context = await rpc<{
      supportCase: SupportCase;
      inbound: SupportMessage;
      message_ids: string[];
    }>(client, "support_delivery_context", { p_case: caseId });
    const c = context.supportCase;
    if (!c.gmail_thread_id || !context.inbound?.gmail_message_id)
      throw new InboxError(
        "NO_GMAIL_THREAD",
        "Only imported Gmail conversations can receive replies.",
        409,
      );
    const connection = await inboxConnection(client);
    if (
      kind === "GMAIL_DRAFT" &&
      !connection.scopes.includes(GMAIL_COMPOSE_SCOPE)
    )
      throw new InboxError(
        "COMPOSE_PERMISSION_REQUIRED",
        "Add gmail.compose to Google Data Access, then reconnect Gmail to grant draft permission.",
        409,
      );
    const access = await inboxAccessToken(connection);
    const reader = gmailReader(access);
    const parent = await preflight(
      reader,
      c.gmail_thread_id,
      context.inbound.gmail_message_id,
      context.message_ids,
      c.customer_email,
      connection.email,
    );
    const subject =
      decodeHeader(header(parent, "Subject")) || c.subject || "(No subject)";
    const id = randomUUID();
    const rfc = `<${id}@cargomove.support>`;
    const raw = rawReply(
      connection.email,
      c.customer_email,
      subject,
      stored.draft.edited_reply,
      rfc,
      parent,
    );
    const claim = await rpc<{ operation: Delivery; cached: boolean }>(
      client,
      automation ? "claim_support_auto_ack" : "claim_support_delivery",
      {
        p_draft: draftId,
        p_expected: expected,
        p_case_version: c.updated_at,
        p_kind: kind,
        p_id: id,
        p_admin: admin.id,
        p_mailbox: connection.google_subject,
        p_email: connection.email,
        p_subject: subject,
        ...(automation
          ? {
              p_rule: supportUuid(automation.ruleId),
              p_rule_version: expectedVersion(automation.ruleVersion),
            }
          : {}),
      },
    );
    if (claim.cached) {
      if (claim.operation.status !== "DONE")
        throw new InboxError("PENDING", messages.PENDING, 409);
      return res.json(claim);
    }
    operation = claim.operation;
    const previousDraft = state.deliveries.find(
      (d) =>
        d.kind === "GMAIL_DRAFT" &&
        d.status === "DONE" &&
        d.context_fingerprint === operation!.context_fingerprint &&
        d.gmail_draft_id,
    );
    const useDraft =
      previousDraft && connection.scopes.includes(GMAIL_COMPOSE_SCOPE);
    const message = { raw, threadId: c.gmail_thread_id };
    const result =
      kind === "SEND"
        ? await gmailWrite(
            access,
            useDraft ? "drafts/send" : "messages/send",
            "POST",
            useDraft ? { id: previousDraft.gmail_draft_id, message } : message,
          )
        : await gmailWrite(
            access,
            previousDraft
              ? `drafts/${validGmailId(previousDraft.gmail_draft_id)}`
              : "drafts",
            previousDraft ? "PUT" : "POST",
            { message },
          );
    const receipt = kind === "SEND" ? result : result.message;
    if (
      !receipt ||
      !/^[a-zA-Z0-9_-]{1,128}$/.test(receipt.id) ||
      receipt.threadId !== c.gmail_thread_id ||
      (kind === "GMAIL_DRAFT" && !/^[a-zA-Z0-9_-]{1,128}$/.test(result.id))
    )
      throw new WriteError(true);
    const completed = await rpc<Delivery>(client, "finish_support_delivery", {
      p_id: operation.id,
      p_message: receipt.id,
      p_thread: receipt.threadId,
      p_draft: kind === "GMAIL_DRAFT" ? result.id : null,
      p_sent_at: new Date().toISOString(),
    });
    operation = undefined;
    return res.json({ operation: completed, cached: false });
  } catch (error) {
    if (operation)
      await client
        .rpc("fail_support_delivery", {
          p_id: operation.id,
          p_uncertain: !(error instanceof WriteError) || error.uncertain,
        })
        .catch(() => undefined);
    return respond(error, res);
  }
}
export async function deliveryReconcile(req: Request, res: Response) {
  noStore(res);
  if (req.method !== "POST")
    return res.status(405).json({ error: "Method not allowed." });
  if (!requireAdmin(req, res)) return;
  const client = configuredClient(res);
  if (!client) return;
  try {
    const body = await bodyOf(req),
      caseId = supportUuid(body.case_id),
      id = supportUuid(body.operation_id);
    const state = await rpc<DeliveryState>(client, "support_delivery_state", {
      p_case: caseId,
    });
    const op = state.deliveries.find((d) => d.id === id);
    if (!op) throw new InboxError("NOT_FOUND", messages.NOT_FOUND, 404);
    if (op.status === "DONE") return res.json({ operation: op });
    if (!["IN_FLIGHT", "UNKNOWN"].includes(op.status))
      throw new SupportQueryError("Only uncertain actions can be checked.");
    // Let the original worker finish before attempting read-only reconciliation.
    if (Date.now() - Date.parse(op.created_at) < 30000)
      throw new InboxError(
        "PENDING",
        "Wait 30 seconds, then check Gmail result.",
        409,
      );
    const connection = await inboxConnection(client);
    if (
      connection.google_subject !== op.mailbox_subject ||
      mailbox(connection.email) !== mailbox(op.mailbox_email)
    )
      throw new InboxError("MAILBOX_CHANGED", messages.MAILBOX_CHANGED, 409);
    const reader = gmailReader(await inboxAccessToken(connection));
    const context = await rpc<{ supportCase: SupportCase }>(
      client,
      "support_delivery_context",
      { p_case: caseId },
    );
    const q = new URLSearchParams({
      q: `in:${op.kind === "SEND" ? "sent" : "drafts"} rfc822msgid:${op.rfc_message_id}`,
      maxResults: "2",
    });
    let messageId: string | undefined,
      draftId: string | null = null;
    if (op.kind === "SEND") {
      const results = await reader.get<{ messages?: Array<{ id: string }> }>(
        "messages",
        q,
      );
      if (results.messages?.length === 1) messageId = results.messages[0].id;
    } else {
      const results = await reader.get<{
        drafts?: Array<{ id: string; message: { id: string } }>;
      }>("drafts", q);
      if (results.drafts?.length === 1) {
        messageId = results.drafts[0].message.id;
        draftId = results.drafts[0].id;
      }
    }
    if (!messageId)
      throw new InboxError(
        "DELIVERY_UNKNOWN",
        "No unique Gmail receipt was found. The action remains blocked; verify the mailbox manually. No email was resent.",
        409,
      );
    const message = await reader.get<MetadataMessage>(
      `messages/${validGmailId(messageId)}`,
      new URLSearchParams({ format: "metadata" }),
    );
    if (
      message.threadId !== context.supportCase.gmail_thread_id ||
      !message.labelIds?.includes(op.kind === "SEND" ? "SENT" : "DRAFT") ||
      header(message, "Message-ID") !== op.rfc_message_id ||
      mailbox(header(message, "From")) !== mailbox(op.mailbox_email) ||
      mailbox(header(message, "To")) !== mailbox(op.recipient_email)
    )
      throw new InboxError(
        "INVALID_RECEIPT",
        "Gmail receipt does not match the approved action.",
        409,
      );
    const timestamp = Number(message.internalDate);
    if (!Number.isFinite(timestamp) || timestamp <= 0)
      throw new InboxError(
        "INVALID_RECEIPT",
        "Gmail receipt has no valid timestamp.",
        409,
      );
    const finished = await rpc<Delivery>(client, "finish_support_delivery", {
      p_id: id,
      p_message: message.id,
      p_thread: message.threadId,
      p_draft: draftId,
      p_sent_at: new Date(timestamp).toISOString(),
    });
    return res.json({ operation: finished });
  } catch (error) {
    return respond(error, res);
  }
}
export async function caseStatus(req: Request, res: Response) {
  noStore(res);
  if (req.method !== "POST")
    return res.status(405).json({ error: "Method not allowed." });
  const admin = requireAdmin(req, res);
  if (!admin) return;
  const client = configuredClient(res);
  if (!client) return;
  try {
    const body = await bodyOf(req);
    if (
      typeof body.reason !== "string" ||
      !body.reason.trim() ||
      body.reason.trim().length > 2000
    )
      throw new SupportQueryError("Provide a reason of 1–2000 characters.");
    if (
      typeof body.action !== "string" ||
      !["ESCALATE", "RESOLVE", "REOPEN"].includes(body.action)
    )
      throw new SupportQueryError("Invalid case action.");
    return res.json(
      await rpc(client, "set_support_case_status", {
        p_id: supportUuid(body.case_id),
        p_expected: expectedVersion(body.updated_at),
        p_action: body.action,
        p_reason: body.reason.trim(),
        p_admin: admin.id,
      }),
    );
  } catch (error) {
    return respond(error, res);
  }
}
