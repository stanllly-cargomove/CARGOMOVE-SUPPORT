import { missingVariables, readSession, serviceRoleKey, supabaseUrl } from './_runtime';

const REQUEST_TIMEOUT_MS = 15_000;

async function readTable(table: string, params: URLSearchParams) {
  if (!supabaseUrl || !serviceRoleKey) throw new Error('Supabase server access is not configured.');
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
    if (!result.ok) throw new Error(`${table}_query_failed_${result.status}`);
    return body;
  } finally {
    clearTimeout(timeout);
  }
}

export default async function snapshot(request: any, response: any) {
  try {
    if (request.method !== 'GET') {
      response.status(405).json({ error: 'Method not allowed.' });
      return;
    }
    const session = readSession(request);
    if (!session || session.type !== 'ADMIN') {
      response.status(401).json({ error: 'Authentication required.' });
      return;
    }
    if (!supabaseUrl || !serviceRoleKey) {
      response.status(503).json({ error: 'Supabase server access is not configured.', missing: missingVariables });
      return;
    }

    const requestedSince = typeof request.query?.since === 'string' ? request.query.since : '';
    const since = requestedSince && !Number.isNaN(Date.parse(requestedSince)) ? requestedSince : null;
    const syncCursor = new Date().toISOString();
    const changedParams = (select: string, order?: string) => {
      const params = new URLSearchParams({ select });
      if (since) params.set('updated_at', `gt.${since}`);
      if (order) params.set('order', order);
      return params;
    };
    const tables = await Promise.all([
      readTable('port_configs', changedParams('*')),
      readTable('depot_configs', changedParams('*')),
      readTable('companies', changedParams('*')),
      readTable('registration_submissions', changedParams('*', 'submitted_at.desc')),
      readTable('user_registrations', changedParams('id,username,email,type,company_id,company_name,full_name,mobile_number,created_at,updated_at', 'created_at.desc')),
      readTable('haulier_guidelines', (() => {
        const params = changedParams('content,updated_at');
        params.set('id', 'eq.default');
        params.set('limit', '1');
        return params;
      })()),
    ]);
    const [ports, depots, companies, submissions, userRegistrations, guidelines] = tables as any[];
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
    console.error('Snapshot function failed:', error);
    response.status(500).json({ error: 'Unable to load application data.' });
  }
}
