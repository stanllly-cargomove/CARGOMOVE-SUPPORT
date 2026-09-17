import type { Delivery, DeliveryState } from "../types/supportDelivery";
import type { SupportReplyDraft } from "../types/supportAI";
import type { SupportCase } from "../types/support";
async function request<T>(
  path: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(`/api/support/${path}`, {
    credentials: "include",
    cache: "no-store",
    signal,
    ...(body
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : {}),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(result.error || "Unable to complete support action.");
  return result;
}
export const getDeliveryState = (caseId: string, signal?: AbortSignal) =>
  request<DeliveryState>(
    `delivery?id=${encodeURIComponent(caseId)}`,
    undefined,
    signal,
  );
export const deliverReply = (
  draft: SupportReplyDraft,
  kind: "SEND" | "GMAIL_DRAFT",
  reviewed: boolean,
) =>
  request<{ operation: Delivery }>("delivery", {
    case_id: draft.case_id,
    draft_id: draft.id,
    updated_at: draft.updated_at,
    kind,
    reviewed,
  });
export const checkDelivery = (op: Delivery) =>
  request<{ operation: Delivery }>("delivery-check", {
    case_id: op.case_id,
    operation_id: op.id,
  });
export const updateCaseStatus = (
  item: SupportCase,
  action: string,
  reason: string,
) =>
  request("case-status", {
    case_id: item.id,
    updated_at: item.updated_at,
    action,
    reason,
  });
