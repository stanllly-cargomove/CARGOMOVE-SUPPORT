import crypto from 'node:crypto';

type AdminUser = {
  id: string;
  username: string;
  email: string;
  type: string;
  full_name: string;
};

function configuration() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const anonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  const sessionSecret = process.env.SESSION_SECRET;
  const missing = [
    !url && 'SUPABASE_URL (or VITE_SUPABASE_URL)',
    !serviceRoleKey && 'SUPABASE_SERVICE_ROLE_KEY',
    !anonKey && 'SUPABASE_ANON_KEY (or VITE_SUPABASE_ANON_KEY)',
    !sessionSecret && 'SESSION_SECRET',
  ].filter(Boolean) as string[];
  return { url, serviceRoleKey, anonKey, sessionSecret, missing };
}

async function parseBody(request: any): Promise<{ identifier?: string; password?: string }> {
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

function sessionCookie(payload: { id: string; email: string; type: string; exp: number }, secret: string) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update(encoded).digest('base64url');
  return `${encoded}.${signature}`;
}

export default async function login(request: any, response: any) {
  let stage = 'configuration';
  try {
    const { url, serviceRoleKey, anonKey, sessionSecret, missing } = configuration();
    if (missing.length || !url || !serviceRoleKey || !anonKey || !sessionSecret) {
      response.status(503).json({ error: 'Server authentication is not configured.', missing });
      return;
    }

    stage = 'request_body';
    const body = await parseBody(request).catch(() => ({})) as { identifier?: string; password?: string };
    const identifier = String(body.identifier || '').trim().toLowerCase();
    const password = String(body.password || '');
    if (!identifier || !password) {
      response.status(400).json({ error: 'Username and password are required.' });
      return;
    }

    const serviceHeaders = { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}` };
    const findAdmin = async (field: 'username' | 'email') => {
      const query = new URLSearchParams({
        select: 'id,username,email,type,full_name',
        [field]: `eq.${identifier}`,
        type: 'eq.ADMIN',
        limit: '1',
      });
      const result = await fetch(`${url}/rest/v1/user_registrations?${query.toString()}`, { headers: serviceHeaders });
      if (!result.ok) throw new Error(`admin_lookup_http_${result.status}`);
      const users = await result.json() as AdminUser[];
      return users[0] || null;
    };

    stage = 'admin_lookup';
    const user = await findAdmin('username') || await findAdmin('email');
    if (!user) {
      response.status(401).json({ error: 'Invalid admin credentials.' });
      return;
    }

    stage = 'supabase_auth';
    const authResult = await fetch(`${url}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: user.email, password }),
    });
    const authData = await authResult.json().catch(() => ({}));
    if (!authResult.ok || !authData.user || String(authData.user.email || '').toLowerCase() !== user.email.toLowerCase()) {
      response.status(401).json({ error: 'Invalid admin credentials.' });
      return;
    }

    const token = sessionCookie({ id: authData.user.id, email: user.email, type: user.type, exp: Date.now() + 8 * 60 * 60 * 1000 }, sessionSecret);
    response.setHeader('Set-Cookie', `cargomove_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=28800; ${process.env.VERCEL ? 'Secure' : ''}`);
    response.status(200).json({ user: { id: user.id, username: user.username, email: user.email, type: user.type, full_name: user.full_name } });
  } catch (error) {
    console.error('Login handler failed:', stage, error);
    response.status(500).json({ error: 'Login service error.', stage });
  }
}
