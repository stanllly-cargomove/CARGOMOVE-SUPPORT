import { latestNpEvent, sortNpMovements, type NpQueryResult } from '../../shared/np-query.js';
import { NpQueryError, parseNpHtml } from './parser.js';

export const NP_QUERY_URL = 'https://apps.northport.com.my/e-NP2/query_contN4.php';
export async function queryNorthport(containerNumber: string, fetcher: typeof fetch = fetch, now = () => new Date(), timeoutMs = 15_000): Promise<NpQueryResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetcher(NP_QUERY_URL, {
      method: 'POST', redirect: 'error', cache: 'no-store', signal: controller.signal,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'text/html' },
      body: new URLSearchParams({ cont_num_N4: containerNumber }),
    });
    if (!response.ok) throw new NpQueryError('Northport is temporarily unavailable. Please try again later.', response.status === 429 ? 503 : 502);
    if (!response.body) throw new NpQueryError('Northport returned an empty response. Please try again later.');
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = []; let size = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 2 * 1024 * 1024) { await reader.cancel(); throw new NpQueryError('Northport returned an unexpectedly large response.'); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    const html = Buffer.concat(chunks).toString('utf8');
    const movements = sortNpMovements(parseNpHtml(html, containerNumber));
    const latest = movements.findIndex(record => latestNpEvent(record) !== null);
    return { success: true, containerNumber, queriedAt: now().toISOString(), totalMovements: movements.length, latestRecordedMovementIndex: latest < 0 ? null : latest, movements };
  } catch (error) {
    if (error instanceof NpQueryError) throw error;
    if (controller.signal.aborted) throw new NpQueryError('Northport did not respond in time. Please try again.', 504);
    throw new NpQueryError('Unable to contact Northport. Please try again later.', 503);
  } finally { clearTimeout(timer); }
}
