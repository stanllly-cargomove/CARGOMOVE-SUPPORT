import crypto from 'node:crypto';

// Scope the signature to this operation and this exact durable step. A queued
// pg_net request contains only this short-lived proof, never CRON_SECRET itself.
export function cronSigningPayload(timestamp: string, body: any): string | null {
  if (!body || Array.isArray(body) || typeof body !== 'object' || Object.keys(body).length !== 1) return null;
  const step = Number.isSafeInteger(body.window) && body.window >= 0 ? `window:${body.window}`
    : typeof body.continuationToken === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.continuationToken)
      ? `continuation:${body.continuationToken.toLowerCase()}` : null;
  return step ? `auto-register-cm:v1\n${timestamp}\n${step}` : null;
}

export function signedCronMatches(headers: any, body: unknown, now = Date.now()): boolean {
  const secret = process.env.CRON_SECRET;
  const timestamp = headers?.['x-cargomove-cron-timestamp'];
  const signature = headers?.['x-cargomove-cron-signature'];
  if (!secret || typeof timestamp !== 'string' || !/^\d{10}$/.test(timestamp)
    || Math.abs(Math.floor(now / 1000) - Number(timestamp)) > 120
    || typeof signature !== 'string' || !/^[a-f0-9]{64}$/i.test(signature)) return false;
  const payload = cronSigningPayload(timestamp, body);
  if (!payload) return false;
  const expected = crypto.createHmac('sha256', secret).update(payload).digest();
  return crypto.timingSafeEqual(expected, Buffer.from(signature, 'hex'));
}
