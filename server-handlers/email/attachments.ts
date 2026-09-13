// Routed through the single Express Vercel function.
import crypto from 'node:crypto';
import { ALLOWED_ATTACHMENT_TYPES, bodyOf, MAX_TOTAL_ATTACHMENT_BYTES, noStore, requireAdmin } from '../_email.js';
import { serviceRoleKey, supabaseUrl } from '../../api/_runtime.js';

const BUCKET = 'email-attachments';

export default async function attachmentUpload(request: any, response: any) {
  noStore(response);
  if (request.method !== 'POST') return response.status(405).json({ error: 'Method not allowed.' });
  if (!requireAdmin(request, response)) return;
  if (!supabaseUrl || !serviceRoleKey) return response.status(503).json({ error: 'Supabase Storage is not configured.' });

  const body: Record<string, unknown> = await bodyOf(request).catch(() => ({}));
  const name = String(body.name || '').trim();
  const contentType = String(body.contentType || '').toLowerCase();
  const size = Number(body.size || 0);
  if (!name || name.length > 255 || /[\r\n]/.test(name)) return response.status(400).json({ error: 'A valid attachment name is required.' });
  if (!ALLOWED_ATTACHMENT_TYPES.has(contentType)) return response.status(400).json({ error: 'This attachment type is not supported.' });
  if (!Number.isSafeInteger(size) || size < 1 || size > MAX_TOTAL_ATTACHMENT_BYTES) {
    return response.status(400).json({ error: 'Each attachment must be 15 MB or smaller.' });
  }

  const extension = name.match(/\.([a-z0-9]{1,10})$/i)?.[1]?.toLowerCase();
  const path = `cargomove-welcome/${crypto.randomUUID()}${extension ? `.${extension}` : ''}`;
  const storageResponse = await fetch(`${supabaseUrl}/storage/v1/object/upload/sign/${BUCKET}/${path}`, {
    method: 'POST',
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      'Content-Type': 'application/json',
    },
    body: '{}',
  });
  const result = await storageResponse.json().catch(() => ({}));
  if (!storageResponse.ok || !result.url) {
    return response.status(502).json({ error: String(result.message || result.error || 'Unable to prepare the attachment upload.') });
  }
  const signedUrl = new URL(`${supabaseUrl}/storage/v1${String(result.url)}`).toString();
  response.json({ signedUrl, attachment: { path, name, content_type: contentType, size } });
}
