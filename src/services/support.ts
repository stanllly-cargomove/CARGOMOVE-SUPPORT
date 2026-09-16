import type { SupportCase, SupportMessage } from '../types/support';
import type { AIInteraction } from '../types/supportAI';

/** Support data is accessed only through authenticated server APIs. */
export interface SupportCaseDetail {
  supportCase: SupportCase;
  messages: SupportMessage[];
  message_total: number;
  interactions: AIInteraction[];
}

export interface SupportCaseReader {
  getCase(caseId: string): Promise<SupportCaseDetail | null>;
}

import type {
  SupportCaseFilters,
  SupportCasePage,
  SupportStats,
} from '../types/support';
async function readSupport<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`/api/support/${path}`, {
    credentials: 'include',
    cache: 'no-store',
    signal,
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(body.error || 'Unable to load support data.');
  return body as T;
}
export function getSupportCases(
  filters: SupportCaseFilters = {},
  signal?: AbortSignal,
): Promise<SupportCasePage> {
  const query = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (value !== undefined && value !== '') query.set(key, String(value));
  });
  return readSupport(`cases?${query}`, signal);
}
export function getSupportCase(
  id: string,
  offset = 0,
  signal?: AbortSignal,
): Promise<SupportCaseDetail> {
  return readSupport(
    `case?id=${encodeURIComponent(id)}&offset=${offset}`,
    signal,
  );
}
export function getSupportStats(signal?: AbortSignal): Promise<SupportStats> {
  return readSupport('stats', signal);
}
