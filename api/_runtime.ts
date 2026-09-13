import crypto from 'node:crypto';
import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';

config({ path: '.env.local' });

export const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
export const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
export const anonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
export const sessionSecret = process.env.SESSION_SECRET;

export const missingVariables = [
  !supabaseUrl && 'SUPABASE_URL (or VITE_SUPABASE_URL)',
  !serviceRoleKey && 'SUPABASE_SERVICE_ROLE_KEY',
  !anonKey && 'SUPABASE_ANON_KEY (or VITE_SUPABASE_ANON_KEY)',
  !sessionSecret && 'SESSION_SECRET',
].filter(Boolean) as string[];

export function adminClient() {
  if (!supabaseUrl || !serviceRoleKey) return null;
  try {
    return createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
  } catch {
    return null;
  }
}

export function authClient() {
  if (!supabaseUrl || !anonKey) return null;
  return createClient(supabaseUrl, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
}

export function readSession(request: any) {
  if (!sessionSecret) return null;
  const value = request.headers.cookie?.match(/(?:^|; )cargomove_session=([^;]+)/)?.[1];
  if (!value) return null;
  const [encoded, signature] = value.split('.');
  if (!encoded || !signature) return null;
  const expected = crypto.createHmac('sha256', sessionSecret).update(encoded).digest('base64url');
  if (signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  try {
    const session = JSON.parse(Buffer.from(encoded, 'base64url').toString()) as { id: string; email: string; type: string; exp: number };
    return session.exp > Date.now() ? session : null;
  } catch {
    return null;
  }
}

export function signSession(payload: { id: string; email: string; type: string; exp: number }) {
  if (!sessionSecret) throw new Error('SESSION_SECRET is missing.');
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', sessionSecret).update(encoded).digest('base64url');
  return `${encoded}.${signature}`;
}

export function setSessionCookie(response: any, value: string, maxAge = 28800) {
  response.setHeader('Set-Cookie', `cargomove_session=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}; ${process.env.VERCEL ? 'Secure' : ''}`);
}

export async function requestBody(request: any) {
  if (request.body && typeof request.body === 'object') return request.body;
  if (typeof request.body === 'string') return JSON.parse(request.body);
  return new Promise((resolve, reject) => {
    let raw = '';
    request.on('data', (chunk: Buffer) => { raw += chunk.toString(); });
    request.on('end', () => {
      try { resolve(raw ? JSON.parse(raw) : {}); } catch (error) { reject(error); }
    });
    request.on('error', reject);
  });
}
