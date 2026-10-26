import { cachedMail, expireMail, expireMailStatus, peekMail } from './autoMailCache';
export type KnowledgeArticle = {
  id: string; title: string; content: string; summary: string; category: string; port: string; keywords: string[];
  status: 'DRAFT' | 'APPROVED' | 'ARCHIVED'; version: number; created_at: string; updated_at: string; approved_at: string | null;
};
export type KnowledgeRevision = { id: string; version: number; action: string; created_at: string; snapshot: KnowledgeArticle };

export function peekKnowledgeRequest<T>(scope: string, connection: string, path: string): T | undefined {
  return peekMail<T>(scope, path, connection);
}

export function cachedKnowledgeRequest<T>(scope: string, connection: string, path: string, force = false): Promise<T> {
  return cachedMail<T>(scope, path, { context: connection, force });
}

export function expireKnowledgeRequests(scope: string, connection: string) {
  expireMail(scope, 'knowledge', connection);
  expireMail(scope, 'learning', connection);
}

export async function knowledgeRequest<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`/api/auto-mail/${path}`, { credentials: 'include', cache: 'no-store', signal,
    ...(body !== undefined ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const fallback = path.split('?')[0] === 'incoming-settings'
      ? response.status === 404 ? 'Incoming settings API is unavailable. Restart the local API server or deploy the updated API, then reload incoming settings.' : 'Unable to load incoming draft and automatic reply settings.'
      : 'Unable to access the knowledge base.';
    throw new Error(result.error || fallback);
  }
  if(body!==undefined&&path==='agent-settings')expireMailStatus();
  return result;
}
