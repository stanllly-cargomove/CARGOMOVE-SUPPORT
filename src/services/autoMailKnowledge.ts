import { expireMailStatus } from './autoMailCache';
export type KnowledgeArticle = {
  id: string; title: string; content: string; summary: string; category: string; port: string; keywords: string[];
  status: 'DRAFT' | 'APPROVED' | 'ARCHIVED'; version: number; created_at: string; updated_at: string; approved_at: string | null;
};
export type KnowledgeRevision = { id: string; version: number; action: string; created_at: string; snapshot: KnowledgeArticle };

export async function knowledgeRequest<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`/api/auto-mail/${path}`, { credentials: 'include', cache: 'no-store', signal,
    ...(body !== undefined ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || 'Unable to access the knowledge base.');
  if(body!==undefined&&path==='agent-settings')expireMailStatus();
  return result;
}
