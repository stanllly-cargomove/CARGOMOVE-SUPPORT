import { requestBody } from '../../api/_runtime.js';
import { schedulerAdmin, allowedOrigin } from '../scheduler/access.js';
import { normalizeContainerNumber, validContainerNumber } from '../../shared/np-query.js';
import { NpQueryError } from './parser.js';
import { queryNorthport } from './service.js';

export function createNpQueryHandler(deps = { authorize: schedulerAdmin, allowedOrigin, requestBody, queryNorthport, now: Date.now }) {
  // Per-instance protection; no polling or automatic retries against the public service.
  const requests = new Map<string, { active: boolean; started: number }>();
  return async function npQuery(request: any, response: any) {
    response.setHeader('Cache-Control', 'no-store');
    const fail = (status: number, error: string) => response.status(status).json({ success: false, error });
    if (request.method !== 'POST') { response.setHeader('Allow', 'POST'); return fail(405, 'Method not allowed.'); }
    const access = await deps.authorize(request);
    if ('code' in access) return fail(access.code, access.message);
    if (!deps.allowedOrigin(request.headers.origin) || request.headers['sec-fetch-site'] === 'cross-site' || request.headers['x-cargomove-confirm'] !== 'np-query') return fail(403, 'Invalid request origin or confirmation.');
    let input: any;
    try { input = await deps.requestBody(request); } catch { return fail(400, 'Invalid query request.'); }
    if (!input || typeof input.containerNumber !== 'string' || input.containerNumber.length > 64) return fail(400, 'Enter a valid container number.');
    const containerNumber = normalizeContainerNumber(input.containerNumber);
    if (!validContainerNumber(containerNumber)) return fail(400, 'Use four letters (ending U, J or Z) followed by seven digits.');
    const actor = access.session.id;
    const previous = requests.get(actor), now = deps.now();
    if (previous && (previous.active || now - previous.started < 3000)) { response.setHeader('Retry-After', '3'); return fail(429, 'Please wait a few seconds before querying again.'); }
    for (const [key, value] of requests) if (!value.active && now - value.started >= 3000) requests.delete(key);
    if (requests.size >= 1000) return fail(503, 'Container queries are busy. Please try again shortly.');
    const state = { active: true, started: now }; requests.set(actor, state);
    try { return response.json(await deps.queryNorthport(containerNumber)); }
    catch (error) { return fail(error instanceof NpQueryError ? error.status : 503, error instanceof NpQueryError ? error.message : 'Northport query is temporarily unavailable.'); }
    finally { state.active = false; }
  };
}
export default createNpQueryHandler();
