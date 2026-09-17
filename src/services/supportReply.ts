import type {
  StoredReply,
  ReplyTemplate,
  SupportReplyDraft,
} from '../types/supportAI';
async function requestReply<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(`/api/support/${path}`, {
    credentials: 'include',
    cache: 'no-store',
    ...init,
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(body.error || 'Unable to access reply drafts.');
  return body as T;
}
export function getSupportReply(
  id: string,
  signal?: AbortSignal,
  draftId?: string,
): Promise<StoredReply> {
  return requestReply(
    `reply?id=${encodeURIComponent(id)}${draftId ? `&draft_id=${encodeURIComponent(draftId)}` : ''}`,
    { signal },
  );
}
export function generateSupportReply(
  id: string,
  template: ReplyTemplate,
): Promise<StoredReply & { cached: boolean }> {
  return requestReply('generate-reply', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ case_id: id, template_id: template }),
  });
}
export function editSupportReply(
  draft: SupportReplyDraft,
  text: string,
): Promise<StoredReply> {
  return requestReply('reply', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: draft.id,
      updated_at: draft.updated_at,
      reply_text: text,
    }),
  });
}
