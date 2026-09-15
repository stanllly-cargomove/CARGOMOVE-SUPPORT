import crypto from 'node:crypto';

const externalUserFields = 'id,username,email,password,company_id,company_name,full_name,mobile_number,status,rejection_reason,rejection_detail,email_status,email_sent,created_at,updated_at';
const legacyExternalUserFields = 'id,username,email,password,company_id,company_name,full_name,mobile_number,created_at,updated_at';
const INCREMENTAL_READ_LIMIT = 200;

function isMissingWorkflowColumn(error: unknown) {
  const detail = JSON.stringify(error).toLowerCase();
  return detail.includes('status') || detail.includes('email_sent') || detail.includes('email_status') || detail.includes('rejection_reason') || detail.includes('rejection_detail');
}

function normalizeExternalUsers(users: unknown) {
  if (!Array.isArray(users)) return [];
  return users.map((user) => ({
    ...user,
    status: ['PENDING', 'DONE', 'REJECTED'].includes(user?.status) ? user.status : 'PENDING',
    email_sent: user?.email_sent === 1 ? 1 : 0,
    email_status: ['NOT_READY', 'READY', 'SENDING', 'SENT', 'FAILED'].includes(user?.email_status)
      ? user.email_status
      : user?.email_sent === 1 ? 'SENT' : ['DONE', 'REJECTED'].includes(user?.status) ? 'READY' : 'NOT_READY',
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
  response.setHeader('Cache-Control', 'no-store, max-age=0');
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
      const requestedSince = typeof request.query?.since === 'string' ? request.query.since : '';
      const since = requestedSince && !Number.isNaN(Date.parse(requestedSince)) ? requestedSince : null;
      let syncCursor = new Date().toISOString();
      const query = new URLSearchParams({ select: externalUserFields, order: since ? 'updated_at.asc' : 'created_at.desc' });
      if (since) {
        query.set('updated_at', `gt.${since}`);
        query.set('limit', String(INCREMENTAL_READ_LIMIT));
      }
      let result = await fetch(`${url}/rest/v1/external_user_access?${query.toString()}`, { headers });
      let users = await result.json().catch(() => null);

      // Some installations created this table before the workflow columns were
      // introduced. Keep their records visible while migration 000040 is applied.
      if (!result.ok && isMissingWorkflowColumn(users)) {
        const legacyQuery = new URLSearchParams({ select: legacyExternalUserFields, order: since ? 'updated_at.asc' : 'created_at.desc' });
        if (since) {
          legacyQuery.set('updated_at', `gt.${since}`);
          legacyQuery.set('limit', String(INCREMENTAL_READ_LIMIT));
        }
        result = await fetch(`${url}/rest/v1/external_user_access?${legacyQuery.toString()}`, { headers });
        users = await result.json().catch(() => null);
      }

      if (!result.ok) {
        response.status(502).json({ error: 'Unable to load external user access from Supabase.' });
        return;
      }
      if (since && Array.isArray(users) && users.length === INCREMENTAL_READ_LIMIT) {
        syncCursor = users[users.length - 1]?.updated_at || syncCursor;
      }
      response.json({ users: normalizeExternalUsers(users), syncCursor });
      return;
    }

    if (request.method === 'PATCH') {
      const body = typeof request.body === 'string' ? JSON.parse(request.body) : request.body || {};
      const id = String(body.id || '').trim();
      const changes: Record<string, unknown> = {};
      const requiredTextFields = ['username', 'email', 'password', 'full_name', 'mobile_number'] as const;
      for (const field of requiredTextFields) {
        if (body[field] === undefined) continue;
        const value = String(body[field]).trim();
        if (!value) {
          response.status(400).json({ error: `${field.replace('_', ' ')} is required.` });
          return;
        }
        changes[field] = field === 'username' || field === 'email' ? value.toLowerCase() : value;
      }
      if (body.company_name !== undefined) changes.company_name = String(body.company_name).trim().toUpperCase();
      if (body.status !== undefined) {
        if (!['PENDING', 'DONE', 'REJECTED'].includes(body.status)) {
          response.status(400).json({ error: 'Invalid registration status.' });
          return;
        }
        changes.status = body.status;
      }
      if (body.rejection_reason !== undefined) {
        if (body.rejection_reason !== null && !['ALREADY_REGISTERED_BOTH', 'NORTHPORT_ADDED', 'OTHER'].includes(body.rejection_reason)) {
          response.status(400).json({ error: 'Invalid rejection reason.' });
          return;
        }
        changes.rejection_reason = body.rejection_reason;
      }
      if (body.rejection_detail !== undefined) {
        const detail = body.rejection_detail === null ? null : String(body.rejection_detail).trim();
        if (detail && detail.length > 2000) {
          response.status(400).json({ error: 'The rejection details must be 2,000 characters or fewer.' });
          return;
        }
        changes.rejection_detail = detail || null;
      }
      if (body.status === 'REJECTED') {
        const reason = body.rejection_reason;
        if (!['ALREADY_REGISTERED_BOTH', 'NORTHPORT_ADDED', 'OTHER'].includes(reason)) {
          response.status(400).json({ error: 'Select a rejection reason.' });
          return;
        }
        if (reason === 'OTHER' && !String(body.rejection_detail || '').trim()) {
          response.status(400).json({ error: 'Enter the reason for rejecting this registration.' });
          return;
        }
      } else if (body.status !== undefined) {
        changes.rejection_reason = null;
        changes.rejection_detail = null;
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
        response.status(result.status === 409 ? 409 : 400).json({
          error: result.status === 409
            ? 'That username or email is already in use.'
            : isMissingWorkflowColumn(saved)
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
      body: JSON.stringify({ ...body, id: body.id || `external-user-${Date.now()}`, username, email, password, company_name: String(body.company_name || '').trim().toUpperCase(), full_name: fullName, mobile_number: mobileNumber }),
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
