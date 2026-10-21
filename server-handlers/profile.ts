import { createClient } from '@supabase/supabase-js';
import { put, del } from '@vercel/blob';
import { schedulerAdmin } from './scheduler/access.js';
import { requestBody } from '../api/_runtime.js';

async function removeManagedPhoto(account: string, value: string, removeBlob: typeof del) {
  const url = new URL(value);
  if (url.protocol === 'https:' && url.hostname.endsWith('.public.blob.vercel-storage.com') && url.pathname.startsWith(`/avatars/${account}/`)) {
    await removeBlob(value);
  }
}

export function createProfileHandler(deps = {
  authorize: schedulerAdmin,
  authClient: () => createClient(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } }),
  put, del,
}) {
  return async function profile(request: any, response: any) {
    response.setHeader('Cache-Control', 'no-store, private');
    if (!['GET', 'POST', 'PATCH', 'DELETE'].includes(request.method)) return response.status(405).json({ error: 'Method not allowed.' });
    if (request.method !== 'GET' && (request.headers['sec-fetch-site'] === 'cross-site' || !String(request.headers['content-type'] || '').startsWith('application/json'))) {
      return response.status(403).json({ error: 'Invalid profile request.' });
    }
    const access = await deps.authorize(request);
    if ('code' in access) return response.status(access.code).json({ error: access.message });
    try {
      const client = deps.authClient();
      const { data, error } = await client.auth.admin.getUserById(access.session.id);
      if (error || !data.user) throw new Error('Unable to load your profile.');
      const oldUrl = data.user.user_metadata?.avatar_url as string | undefined;
      if (request.method === 'GET' && typeof request.query?.username === 'string') {
        const username = request.query.username.trim().toLowerCase();
        if (!/^[a-z0-9._-]{4,16}$/.test(username)) return response.status(400).json({ error: 'Use 4–16 lowercase letters, numbers, dots, underscores or hyphens.' });
        if (username === String(data.user.user_metadata?.username || '').toLowerCase()) return response.json({ available: true });
        const existing = await access.client.from('user_registrations').select('id').eq('username', username).neq('email', access.session.email).maybeSingle();
        if (existing.error) throw new Error('Unable to check username availability.');
        return response.json({ available: !existing.data });
      }
      if (request.method === 'GET') return response.json({ avatar_url: oldUrl || null });
      if (request.method === 'PATCH') {
        const body = await requestBody(request);
        if (typeof body?.full_name === 'string') {
          const fullName = body.full_name.trim();
          if (!fullName || fullName.length > 120) return response.status(400).json({ error: 'Full name must be between 1 and 120 characters.' });
          const updated = await access.client.from('user_registrations').update({ full_name: fullName }).eq('email', access.session.email).eq('type', 'ADMIN').select('full_name').single();
          if (updated.error || !updated.data) throw new Error('Unable to save your full name.');
          const savedUser = await client.auth.admin.updateUserById(access.session.id, { user_metadata: { ...data.user.user_metadata, full_name: fullName } });
          if (savedUser.error) throw new Error('Your full name was updated, but the account profile could not be synchronized.');
          return response.json({ full_name: fullName });
        }
        const username = String(body?.username || '').trim().toLowerCase();
        if (!/^[a-z0-9._-]{4,16}$/.test(username)) return response.status(400).json({ error: 'Use 4–16 lowercase letters, numbers, dots, underscores or hyphens.' });
        const existing = await access.client.from('user_registrations').select('id').eq('username', username).neq('email', access.session.email).maybeSingle();
        if (existing.error) throw new Error('Unable to check username availability.');
        if (existing.data) return response.status(409).json({ error: 'That username is already in use.' });
        const updated = await access.client.from('user_registrations').update({ username }).eq('email', access.session.email).eq('type', 'ADMIN').select('username').single();
        if (updated.error || !updated.data) throw new Error('Unable to save your username.');
        const savedUser = await client.auth.admin.updateUserById(access.session.id, { user_metadata: { ...data.user.user_metadata, username } });
        if (savedUser.error) throw new Error('Your username was updated, but the account profile could not be synchronized.');
        return response.json({ username });
      }
      let nextUrl: string | null = null;
      if (request.method === 'POST') {
        // The SDK handles the connected store's rotating Vercel OIDC credentials.
        // A read-write token also remains supported for local development.
        if (!process.env.BLOB_STORE_ID?.trim() && !process.env.BLOB_READ_WRITE_TOKEN?.trim()) return response.status(503).json({ error: 'Profile photos use Vercel Blob. Connect a public Blob store to this project and redeploy so BLOB_STORE_ID is available. For local development, configure BLOB_READ_WRITE_TOKEN.' });
        const body = await requestBody(request);
        const image = typeof body?.image === 'string' ? body.image : '';
        if (image.length > 900_000 || !/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(image)) return response.status(400).json({ error: 'Upload a cropped JPEG image under 650 KB.' });
        const bytes = Buffer.from(image.split(',')[1], 'base64');
        if (bytes.length > 650_000 || bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) return response.status(400).json({ error: 'Invalid JPEG image.' });
        const blob = await deps.put(`avatars/${access.session.id}/profile.jpg`, bytes, { access: 'public', addRandomSuffix: true, contentType: 'image/jpeg' });
        nextUrl = blob.url;
      }
      if (request.method === 'DELETE' && oldUrl && (process.env.BLOB_STORE_ID?.trim() || process.env.BLOB_READ_WRITE_TOKEN?.trim())) {
        // Production removes the managed Vercel Blob before clearing the profile reference.
        // Local development without Blob credentials can still clear the reference.
        await removeManagedPhoto(access.session.id, oldUrl, deps.del);
      }
      const saved = await client.auth.admin.updateUserById(access.session.id, { user_metadata: { ...data.user.user_metadata, avatar_url: nextUrl } });
      if (saved.error) {
        if (nextUrl) await removeManagedPhoto(access.session.id,nextUrl,deps.del).catch(() => {});
        throw new Error('Unable to save your profile picture. Please try again.');
      }
      // Only delete images inside this account's managed storage directory.
      if (request.method === 'POST' && oldUrl && oldUrl !== nextUrl) {
        await removeManagedPhoto(access.session.id,oldUrl,deps.del).catch(() => {});
      }
      return response.json({ avatar_url: nextUrl });
    } catch (error) {
      console.error('Profile update failed', error);
      return response.status(502).json({ error: error instanceof Error ? error.message : 'Unable to update profile.' });
    }
  };
}

export default createProfileHandler();
