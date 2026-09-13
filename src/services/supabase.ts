export const isSupabaseConfigured = true;

interface Snapshot {
  ports: unknown[];
  depots: unknown[];
  companies: unknown[];
  submissions: unknown[];
  userRegistrations: unknown[];
  guideline: unknown;
}

async function parseResponse<T>(response: Response): Promise<T | null> {
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    console.error('API request failed:', body.error || response.statusText);
    return null;
  }
  return response.status === 204 ? null : response.json();
}

export async function fetchSupabaseSnapshot(): Promise<Snapshot | null> {
  const response = await fetch('/api/snapshot', { credentials: 'include' });
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
