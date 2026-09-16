import type { AIInteraction, SupportAnalysisResult } from '../types/supportAI';
export interface StoredAnalysis {
  interaction: AIInteraction | null;
  stale: boolean;
}
export async function getSupportAnalysis(
  id: string,
  signal?: AbortSignal,
): Promise<StoredAnalysis> {
  const response = await fetch(
    `/api/support/analysis?id=${encodeURIComponent(id)}`,
    { credentials: 'include', cache: 'no-store', signal },
  );
  const body = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(body.error || 'Unable to load AI analysis.');
  return body;
}
export async function analyzeSupportCase(
  id: string,
): Promise<SupportAnalysisResult> {
  const response = await fetch('/api/support/analyze', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ case_id: id }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(
      body.error ||
        'Unable to analyze this case. Continue handling it manually.',
    );
  return body;
}
