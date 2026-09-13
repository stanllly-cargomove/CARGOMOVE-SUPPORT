import crypto from 'node:crypto';

type CreateUserInput = {
  username?: string;
  fullName?: string;
  password?: string;
  mobileNumber?: string;
  email?: string;
};

function readAdminSession(request: any) {
  const secret = process.env.SESSION_SECRET;
  const value = request.headers?.cookie?.match(/(?:^|; )cargomove_session=([^;]+)/)?.[1];
  if (!secret || !value) return null;
  const [encoded, signature] = value.split('.');
  if (!encoded || !signature) return null;
  const expected = crypto.createHmac('sha256', secret).update(encoded).digest('base64url');
  if (signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  try {
    const session = JSON.parse(Buffer.from(encoded, 'base64url').toString()) as { type: string; exp: number };
    return session.type === 'ADMIN' && session.exp > Date.now() ? session : null;
  } catch {
    return null;
  }
}

async function readBody(request: any): Promise<CreateUserInput> {
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

export default async function createAdminUser(request: any, response: any) {
  if (!readAdminSession(request)) {
    response.status(401).json({ error: 'Authentication required.' });
    return;
  }

  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    response.status(503).json({ error: 'Supabase server access is not configured.' });
    return;
  }

  try {
    const body = await readBody(request);
    const username = String(body.username || '').trim().toLowerCase();
    const fullName = String(body.fullName || '').trim();
    const password = String(body.password || '');
    const mobileNumber = String(body.mobileNumber || '').trim();
    const email = String(body.email || '').trim().toLowerCase();
    if (!username || !fullName || !mobileNumber || !email || !/^\S+@\S+\.\S+$/.test(email)) {
      response.status(400).json({ error: 'Username, name, phone number, and a valid email are required.' });
      return;
    }
    if (!/^[a-z0-9._-]{3,64}$/.test(username)) {
      response.status(400).json({ error: 'Username must use 3–64 lowercase letters, numbers, dots, underscores, or hyphens.' });
      return;
    }
    if (password.length < 6) {
      response.status(400).json({ error: 'Password must be at least 6 characters.' });
      return;
    }

    const headers = {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      'Content-Type': 'application/json',
    };
    const existingQuery = new URLSearchParams({
      select: 'id',
      or: `(username.eq.${username},email.eq.${email})`,
      limit: '1',
    });
    const existing = await fetch(`${url}/rest/v1/user_registrations?${existingQuery.toString()}`, { headers });
    if (!existing.ok) throw new Error(`application_user_lookup_${existing.status}`);
    if ((await existing.json()).length > 0) {
      response.status(409).json({ error: 'That username or email is already registered.' });
      return;
    }

    const authResult = await fetch(`${url}/auth/v1/admin/users`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        email,
        password,
        email_confirm: true,
        user_metadata: { username, full_name: fullName, mobile_number: mobileNumber },
      }),
    });
    const authData = await authResult.json().catch(() => ({}));
    const authUserId = authData.id || authData.user?.id;
    if (!authResult.ok || !authUserId) {
      response.status(400).json({ error: 'Unable to create the Supabase Auth user.' });
      return;
    }

    const applicationResult = await fetch(`${url}/rest/v1/user_registrations`, {
      method: 'POST',
      headers: { ...headers, Prefer: 'return=representation' },
      body: JSON.stringify({
        id: authUserId,
        username,
        email,
        password_hash: 'managed_by_supabase_auth',
        type: 'ADMIN',
        company_id: null,
        company_name: '',
        full_name: fullName,
        mobile_number: mobileNumber,
      }),
    });
    const applicationData = await applicationResult.json().catch(() => ({}));
    if (!applicationResult.ok) {
      await fetch(`${url}/auth/v1/admin/users/${authUserId}`, { method: 'DELETE', headers });
      response.status(400).json({ error: 'Unable to save the application user.' });
      return;
    }

    response.status(201).json({ user: Array.isArray(applicationData) ? applicationData[0] : applicationData });
  } catch (error) {
    console.error('Create admin user failed:', error);
    response.status(500).json({ error: 'Unable to create the admin user.' });
  }
}
