import type {
  SupportLearningSuggestion,
  SupportKnowledge,
  KnowledgeArticleInput,
} from "../types/knowledge";
export type LearningSuggestion = SupportLearningSuggestion & {
  updated_at: string;
  knowledge_version: string | null;
  approved_knowledge_id: string | null;
  approved_article: SupportKnowledge | null;
};
export interface LearningDetail {
  suggestion: LearningSuggestion;
  knowledge: SupportKnowledge | null;
  evidence: Array<{
    case_id: string;
    interaction_id: string;
    generated_reply: string;
    final_reply: string;
    approved_by: string;
    approved_at: string;
  }>;
}
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
    throw new Error(result.error || "Unable to access learning suggestions.");
  return result;
}
export const listLearning = (
  status: string,
  offset: number,
  signal?: AbortSignal,
) =>
  request<{ suggestions: LearningSuggestion[]; total: number }>(
    `learning?status=${status}&offset=${offset}`,
    undefined,
    signal,
  );
export const getLearning = (id: string, signal?: AbortSignal) =>
  request<LearningDetail>(
    `learning-detail?id=${encodeURIComponent(id)}`,
    undefined,
    signal,
  );
export const detectLearning = () =>
  request<{ created: number }>("learning", { action: "DETECT" });
export const reviewLearning = (
  suggestion: LearningSuggestion,
  article?: KnowledgeArticleInput,
) =>
  request<{ article: SupportKnowledge; suggestion: LearningSuggestion }>(
    "learning",
    {
      action: article ? "APPROVE" : "REJECT",
      id: suggestion.id,
      updated_at: suggestion.updated_at,
      article,
    },
  );
