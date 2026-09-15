import crypto from 'node:crypto';

const REQUEST_TIMEOUT_MS = 15_000;
const MAX_READ_ATTEMPTS = 2;
const RETRY_DELAY_MS = 250;
const INCREMENTAL_READ_LIMIT = 200;

class TableReadError extends Error {
  constructor(
    readonly table: string,
    readonly status?: number,
    readonly retryable = false,
    cause?: unknown,
  ) {
    super(`${table}_query_failed${status ? `_${status}` : ''}`, { cause });
    this.name = 'TableReadError';
  }
}

function configuration() {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const missing = [
    !supabaseUrl && 'SUPABASE_URL (or VITE_SUPABASE_URL)',
    !serviceRoleKey && 'SUPABASE_SERVICE_ROLE_KEY',
    !process.env.SESSION_SECRET && 'SESSION_SECRET',
  ].filter(Boolean) as string[];
  return { supabaseUrl, serviceRoleKey, sessionSecret: process.env.SESSION_SECRET, missing };
}

function readAdminSession(request: any, sessionSecret: string | undefined) {
  const value = request.headers?.cookie?.match(/(?:^|; )cargomove_session=([^;]+)/)?.[1];
  if (!sessionSecret || !value) return null;
  const [encoded, signature] = value.split('.');
  if (!encoded || !signature) return null;
  const expected = crypto.createHmac('sha256', sessionSecret).update(encoded).digest('base64url');
  if (signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  try {
    const session = JSON.parse(Buffer.from(encoded, 'base64url').toString()) as { type: string; exp: number };
    return session.type === 'ADMIN' && session.exp > Date.now() ? session : null;
  } catch {
    return null;
  }
}

async function readTable(supabaseUrl: string, serviceRoleKey: string, table: string, params: URLSearchParams) {
  for (let attempt = 1; attempt <= MAX_READ_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const result = await fetch(`${supabaseUrl}/rest/v1/${table}?${params.toString()}`, {
        headers: {
          apikey: serviceRoleKey,
          Authorization: `Bearer ${serviceRoleKey}`,
          Accept: 'application/json',
        },
        signal: controller.signal,
      });
      const body = await result.json().catch(() => null);
      if (result.ok) return body;

      const retryable = result.status === 408 || result.status === 429 || result.status >= 500;
      if (!retryable || attempt === MAX_READ_ATTEMPTS) {
        throw new TableReadError(table, result.status, retryable);
      }
    } catch (error) {
      if (error instanceof TableReadError) throw error;
      if (attempt === MAX_READ_ATTEMPTS) {
        throw new TableReadError(table, undefined, true, error);
      }
    } finally {
      clearTimeout(timeout);
    }

    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
  }

  throw new TableReadError(table, undefined, true);
}

export default async function snapshot(request: any, response: any) {
  try {
    response.setHeader('Cache-Control', 'no-store, max-age=0');
    if (request.method !== 'GET') {
      response.status(405).json({ error: 'Method not allowed.' });
      return;
    }
    const { supabaseUrl, serviceRoleKey, sessionSecret, missing } = configuration();
    if (missing.length || !supabaseUrl || !serviceRoleKey) {
      response.status(503).json({ error: 'Supabase server access is not configured.', missing });
      return;
    }
    if (!readAdminSession(request, sessionSecret)) {
      response.status(401).json({ error: 'Authentication required.' });
      return;
    }

    const requestedSince = typeof request.query?.since === 'string' ? request.query.since : '';
    const since = requestedSince && !Number.isNaN(Date.parse(requestedSince)) ? requestedSince : null;
    let syncCursor = new Date().toISOString();
    const changedParams = (select: string, order?: string) => {
      const params = new URLSearchParams({ select });
      if (since) {
        params.set('updated_at', `gt.${since}`);
        params.set('order', 'updated_at.asc');
        params.set('limit', String(INCREMENTAL_READ_LIMIT));
      } else if (order) {
        params.set('order', order);
      }
      return params;
    };
    const tables = await Promise.all([
      readTable(supabaseUrl, serviceRoleKey, 'port_configs', changedParams('*')),
      readTable(supabaseUrl, serviceRoleKey, 'depot_configs', changedParams('*')),
      readTable(supabaseUrl, serviceRoleKey, 'companies', changedParams('*')),
      readTable(supabaseUrl, serviceRoleKey, 'registration_submissions', changedParams('*', 'submitted_at.desc')),
      readTable(supabaseUrl, serviceRoleKey, 'user_registrations', changedParams('id,username,email,type,company_id,company_name,full_name,mobile_number,created_at,updated_at', 'created_at.desc')),
      readTable(supabaseUrl, serviceRoleKey, 'haulier_guidelines', (() => {
        const params = changedParams('content,updated_at');
        params.set('id', 'eq.default');
        params.set('limit', '1');
        return params;
      })()),
    ]);
    const [ports, depots, companies, submissions, userRegistrations, guidelines] = tables as any[];
    const cappedTables = [ports, depots, companies, submissions, userRegistrations]
      .filter((rows) => Array.isArray(rows) && rows.length === INCREMENTAL_READ_LIMIT);
    if (since && cappedTables.length > 0) {
      syncCursor = cappedTables.reduce((oldest, rows) => {
        const timestamp = rows[rows.length - 1]?.updated_at;
        return timestamp && Date.parse(timestamp) < Date.parse(oldest) ? timestamp : oldest;
      }, syncCursor);
    }
    const guideline = guidelines?.[0] || null;
    response.status(200).json({
      ports: ports || [],
      depots: depots || [],
      companies: (companies || []).map((company: any) => ({ ...company.details, ...company, details: undefined })),
      submissions: submissions || [],
      userRegistrations: userRegistrations || [],
      guideline: guideline?.content || null,
      guidelineUpdatedAt: guideline?.updated_at || null,
      syncCursor,
    });
  } catch (error) {
    console.error('Snapshot function failed:', error instanceof TableReadError
      ? { table: error.table, status: error.status, retryable: error.retryable, cause: error.cause }
      : error);
    response.status(500).json({ error: 'Unable to load application data.' });
  }
}
