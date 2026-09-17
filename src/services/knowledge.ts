import type {
  KnowledgeArticleInput,
  KnowledgeFilters,
  KnowledgePage,
  KnowledgeMatches,
  SupportKnowledge,
} from '../types/knowledge';
async function knowledgeRequest<T>(
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
    throw new Error(body.error || 'Unable to access knowledge.');
  return body as T;
}
export function getKnowledge(
  filters: KnowledgeFilters = {},
  signal?: AbortSignal,
): Promise<KnowledgePage> {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([k, v]) => {
    if (v !== undefined && v !== '') params.set(k, String(v));
  });
  return knowledgeRequest(`knowledge?${params}`, { signal });
}
export function saveKnowledge(
  article: KnowledgeArticleInput,
  existing?: Pick<SupportKnowledge, 'id' | 'updated_at'>,
): Promise<SupportKnowledge> {
  return knowledgeRequest('knowledge', {
    method: existing ? 'PUT' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ article, ...existing }),
  });
}
export function getKnowledgeMatches(
  id: string,
  signal?: AbortSignal,
): Promise<KnowledgeMatches> {
  return knowledgeRequest(`knowledge-matches?id=${encodeURIComponent(id)}`, {
    signal,
  });
}
