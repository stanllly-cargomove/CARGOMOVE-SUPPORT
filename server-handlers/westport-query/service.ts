import { createHash } from 'node:crypto';
import { validContainerNumber } from '../../shared/np-query.js';
import type { WestportQueryResult } from '../../shared/westport-query.js';
import { NpQueryError } from '../np-query/parser.js';
import { WestportCookies } from './cookies.js';
import { isWestportLogin, parseWestportResponse, WestportSessionExpired } from './parser.js';

export const WESTPORT_URL = 'https://etp.westports.com.my/';
export const WESTPORT_LOGIN_URL = WESTPORT_URL + '?t=default&app=login';
type Credentials = { username: string; password: string };
type Options = { fetcher?: typeof fetch; now?: () => number; credentials?: () => Credentials; timeoutMs?: number };

/** Shared company session, in memory per server instance. No browser automation,
 * live calls on import, credential logging, persistent cookies or query storage.
 */
export function createWestportClient(options: Options = {}) {
  const fetcher = options.fetcher ?? fetch, now = options.now ?? Date.now;
  const credentials = options.credentials ?? (() => ({ username: process.env.WESTPORT_USERNAME?.trim() || '', password: process.env.WESTPORT_PASSWORD || '' }));
  const jar = new WestportCookies(now);
  let authenticatedUntil = 0, authRetryAfter = 0, fingerprint = '', active = false;

  return async function queryWestport(containerNumber: string): Promise<WestportQueryResult> {
    if (!validContainerNumber(containerNumber)) throw new NpQueryError('Enter a valid container number.', 400);
    const account = credentials();
    if (!account.username || !account.password) throw new NpQueryError('Westport queries are not configured. Ask an administrator to configure the shared Westports account.', 503);
    if (active) throw new NpQueryError('Westport queries are busy. Please try again in a few seconds.', 429);
    const currentFingerprint = createHash('sha256').update(JSON.stringify(account)).digest('hex');
    if (fingerprint !== currentFingerprint) { jar.clear(); authenticatedUntil = 0; authRetryAfter = 0; fingerprint = currentFingerprint; }
    if (now() < authRetryAfter) throw new NpQueryError('Westports login is temporarily paused after an unsuccessful attempt. Check the shared account before trying again.', 503);
    active = true;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 20_000);
    async function request(url: string, form?: Record<string, string>, ajax = false, follow = false): Promise<string> {
      let destination = new URL(url), data = form;
      for (let redirects = 0; redirects <= 4; redirects++) {
        if (destination.origin !== new URL(WESTPORT_URL).origin || destination.username || destination.password) throw new NpQueryError('Westports returned an unexpected redirect.');
        const headers: Record<string, string> = { Accept: 'text/html, application/json;q=0.9', Cookie: jar.header(destination) };
        if (data) headers['Content-Type'] = 'application/x-www-form-urlencoded';
        if (ajax) headers['X-Requested-With'] = 'XMLHttpRequest';
        const response = await fetcher(destination.href, { method: data ? 'POST' : 'GET', body: data ? new URLSearchParams(data) : undefined, headers, redirect: 'manual', cache: 'no-store', signal: controller.signal });
        jar.update(response.headers, destination);
        if ([301, 302, 303, 307, 308].includes(response.status)) {
          await response.body?.cancel();
          const location = response.headers.get('location');
          if (!follow) {
            const target = location ? new URL(location, destination) : null;
            if (target?.origin === destination.origin && target.searchParams.get('app') === 'login') throw new WestportSessionExpired();
            throw new NpQueryError('Westports returned an unexpected query redirect.');
          }
          if (!location || redirects === 4) throw new NpQueryError('Westports returned too many login redirects.');
          destination = new URL(location, destination);
          if ([301, 302, 303].includes(response.status)) data = undefined;
          continue;
        }
        if (!response.ok) {
          await response.body?.cancel();
          if (!follow && [401, 403].includes(response.status)) throw new WestportSessionExpired();
          throw new NpQueryError('Westports is temporarily unavailable. Please try again later.', response.status === 429 ? 503 : 502);
        }
        if (!response.body) throw new NpQueryError('Westports returned an empty response.');
        const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.length;
            if (size > 2 * 1024 * 1024) { await reader.cancel(); throw new NpQueryError('Westports returned an unexpectedly large response.'); }
            chunks.push(value);
          }
        } finally { reader.releaseLock(); }
        return Buffer.concat(chunks).toString('utf8');
      }
      throw new NpQueryError('Westports login did not complete.');
    }
    async function login() {
      jar.clear(); authenticatedUntil = 0;
      // Pause even if the network breaks after credentials reach the upstream.
      authRetryAfter = now() + 60_000;
      await request(WESTPORT_LOGIN_URL, undefined, false, true);
      const attempt = (await request(WESTPORT_LOGIN_URL, { node_ajax_id: '50', action: 'signin_attempt', user_id: account.username, password: account.password }, true)).trim();
      if (attempt !== 'Proceed') throw new NpQueryError('Westports rejected the shared account login or requires account attention. Sign in to Westports directly to check the account.', 503);
      const page = await request(WESTPORT_LOGIN_URL, { userid: account.username, passwd: account.password }, false, true);
      if (isWestportLogin(page) || !jar.header(new URL(WESTPORT_URL))) throw new NpQueryError('Westports login did not create an authenticated session. Check the shared account.', 503);
      authenticatedUntil = now() + 7 * 60 * 60 * 1000;
      authRetryAfter = 0;
    }
    try {
      let loggedIn = false;
      if (now() >= authenticatedUntil || !jar.header(new URL(WESTPORT_URL))) { await login(); loggedIn = true; }
      const lookup = async () => parseWestportResponse(await request(WESTPORT_URL, { node_ajax_id: '2609', action: 'get_container', cont_no: containerNumber }, true), containerNumber);
      let table;
      try { table = await lookup(); }
      catch (error) {
        if (!(error instanceof WestportSessionExpired)) throw error;
        jar.clear(); authenticatedUntil = 0;
        if (loggedIn) { authRetryAfter = now() + 60_000; throw new NpQueryError('Westports did not accept the new login session. Check the shared account before trying again.', 503); }
        await login();
        try { table = await lookup(); }
        catch (renewedError) {
          if (renewedError instanceof WestportSessionExpired) { jar.clear(); authenticatedUntil = 0; authRetryAfter = now() + 60_000; }
          throw renewedError;
        }
      }
      return { success: true, port: 'westport', containerNumber, queriedAt: new Date(now()).toISOString(), totalMovements: table.movements.length, ...table };
    } catch (error) {
      if (controller.signal.aborted) throw new NpQueryError('Westports did not respond in time. Please try again.', 504);
      if (error instanceof NpQueryError) throw error;
      throw new NpQueryError('Unable to contact Westports. Please try again later.', 503);
    } finally { clearTimeout(timer); active = false; }
  };
}

export const queryWestport = createWestportClient();
