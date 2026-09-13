import crypto from 'node:crypto';

const externalUserFields = 'id,username,email,password,company_id,company_name,full_name,mobile_number,status,email_status,email_sent,created_at';
const legacyExternalUserFields = 'id,username,email,password,company_id,company_name,full_name,mobile_number,created_at';

function isMissingWorkflowColumn(error: unknown) {
  const detail = JSON.stringify(error).toLowerCase();
  return detail.includes('status') || detail.includes('email_sent') || detail.includes('email_status');
}

function normalizeExternalUsers(users: unknown) {
  if (!Array.isArray(users)) return [];
  return users.map((user) => ({
    ...user,
    status: ['PENDING', 'DONE', 'REJECTED'].includes(user?.status) ? user.status : 'PENDING',
    email_sent: user?.email_sent === 1 ? 1 : 0,
    email_status: ['NOT_READY', 'READY', 'SENDING', 'SENT', 'FAILED'].includes(user?.email_status)
      ? user.email_status
      : user?.email_sent === 1 ? 'SENT' : user?.status === 'DONE' ? 'READY' : 'NOT_READY',
  }));
}

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

  if ((request.method === 'GET' || request.method === 'PATCH') && !isAdmin(request)) {
    response.status(401).json({ error: 'Authentication required.' });
    return;
  }

  try {
    const headers = { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}`, 'Content-Type': 'application/json' };
    if (request.method === 'GET') {
      const query = new URLSearchParams({ select: externalUserFields, order: 'created_at.desc' });
      let result = await fetch(`${url}/rest/v1/external_user_access?${query.toString()}`, { headers });
      let users = await result.json().catch(() => null);

      // Some installations created this table before the workflow columns were
      // introduced. Keep their records visible while migration 000040 is applied.
      if (!result.ok && isMissingWorkflowColumn(users)) {
        const legacyQuery = new URLSearchParams({ select: legacyExternalUserFields, order: 'created_at.desc' });
        result = await fetch(`${url}/rest/v1/external_user_access?${legacyQuery.toString()}`, { headers });
        users = await result.json().catch(() => null);
      }

      if (!result.ok) {
        response.status(502).json({ error: 'Unable to load external user access from Supabase.' });
        return;
      }
      response.json({ users: normalizeExternalUsers(users) });
      return;
    }

    if (request.method === 'PATCH') {
      const body = typeof request.body === 'string' ? JSON.parse(request.body) : request.body || {};
      const id = String(body.id || '').trim();
      const changes: Record<string, unknown> = {};
      if (body.status !== undefined) {
        if (!['PENDING', 'DONE', 'REJECTED'].includes(body.status)) {
          response.status(400).json({ error: 'Invalid registration status.' });
          return;
        }
        changes.status = body.status;
      }
      if (body.email_sent !== undefined) {
        if (![0, 1, true, false].includes(body.email_sent)) {
          response.status(400).json({ error: 'Invalid email sent status.' });
          return;
        }
        changes.email_sent = body.email_sent === true || body.email_sent === 1 ? 1 : 0;
      }
      if (!id || Object.keys(changes).length === 0) {
        response.status(400).json({ error: 'A user id and at least one valid change are required.' });
        return;
      }
      const result = await fetch(`${url}/rest/v1/external_user_access?id=eq.${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { ...headers, Prefer: 'return=representation' },
        body: JSON.stringify(changes),
      });
      const saved = await result.json().catch(() => ({}));
      if (!result.ok) {
        response.status(400).json({
          error: isMissingWorkflowColumn(saved)
            ? 'The external user workflow migration has not been applied yet.'
            : 'Unable to update external user access.',
        });
        return;
      }
      response.json({ user: Array.isArray(saved) ? saved[0] : saved });
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
