export const isSupabaseConfigured = true;

export interface Snapshot {
  ports: unknown[];
  depots: unknown[];
  companies: unknown[];
  submissions: unknown[];
  userRegistrations: unknown[];
  guideline: unknown;
  guidelineUpdatedAt?: string | null;
  syncCursor?: string;
}

async function parseResponse<T>(response: Response): Promise<T | null> {
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const message = body.error || response.statusText || `Request failed with status ${response.status}.`;
    console.error('API request failed:', message);
    throw new Error(message);
  }
  return response.status === 204 ? null : response.json();
}

export async function fetchSupabaseSnapshot(since?: string): Promise<Snapshot | null> {
  const query = since ? `?since=${encodeURIComponent(since)}` : '';
  const response = await fetch(`/api/snapshot${query}`, { credentials: 'include' });
  return parseResponse<Snapshot>(response);
}

export async function upsertSupabaseRow(table: string, row: object) {
  const response = await fetch(`/api/data/${encodeURIComponent(table)}`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(row),
  });
  await parseResponse(response);
}

export async function deleteSupabaseRow(table: string, id: string) {
  const response = await fetch(`/api/data/${encodeURIComponent(table)}/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    credentials: 'include',
  });
  await parseResponse(response);
}
