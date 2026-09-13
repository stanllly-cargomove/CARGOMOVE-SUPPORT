import crypto from 'node:crypto';

function isAdmin(request: any) {
  const secret = process.env.SESSION_SECRET;
  const value = request.headers?.cookie?.match(/(?:^|; )cargomove_session=([^;]+)/)?.[1];
  if (!secret || !value) return false;
  const [encoded, signature] = value.split('.');
  if (!encoded || !signature) return false;
  const expected = crypto.createHmac('sha256', secret).update(encoded).digest('base64url');
  if (signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return false;
  try {
    const session = JSON.parse(Buffer.from(encoded, 'base64url').toString());
    return session.type === 'ADMIN' && session.exp > Date.now();
  } catch {
    return false;
  }
}

export default async function externalUserAccess(request: any, response: any) {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    response.status(503).json({ error: 'Supabase server access is not configured.' });
    return;
  }

  if (request.method === 'GET' && !isAdmin(request)) {
    response.status(401).json({ error: 'Authentication required.' });
    return;
  }

  try {
    const headers = { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}`, 'Content-Type': 'application/json' };
    if (request.method === 'GET') {
      const query = new URLSearchParams({ select: 'id,username,email,password,company_id,company_name,full_name,mobile_number,created_at', order: 'created_at.desc' });
      const result = await fetch(`${url}/rest/v1/external_user_access?${query.toString()}`, { headers });
      const users = await result.json().catch(() => []);
      if (!result.ok) throw new Error('external_user_access_lookup_failed');
      response.json({ users });
      return;
    }

    if (request.method !== 'POST') {
      response.status(405).json({ error: 'Method not allowed.' });
      return;
    }

    const body = typeof request.body === 'string' ? JSON.parse(request.body) : request.body || {};
    const username = String(body.username || '').trim().toLowerCase();
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');
    const fullName = String(body.full_name || '').trim();
    const mobileNumber = String(body.mobile_number || '').trim();
    if (!username || !email || !password || !fullName || !mobileNumber) {
      response.status(400).json({ error: 'Username, email, password, full name, and mobile number are required.' });
      return;
    }

    const result = await fetch(`${url}/rest/v1/external_user_access`, {
      method: 'POST',
      headers: { ...headers, Prefer: 'resolution=merge-duplicates,return=representation' },
      body: JSON.stringify({ ...body, id: body.id || `external-user-${Date.now()}`, username, email, password, full_name: fullName, mobile_number: mobileNumber }),
    });
    const saved = await result.json().catch(() => ({}));
    if (!result.ok) {
      response.status(result.status === 409 ? 409 : 400).json({ error: 'Unable to save external user access.' });
      return;
    }
    response.status(201).json({ user: Array.isArray(saved) ? saved[0] : saved });
  } catch (error) {
    console.error('External user access request failed:', error);
    response.status(500).json({ error: 'Unable to process external user access.' });
  }
}
