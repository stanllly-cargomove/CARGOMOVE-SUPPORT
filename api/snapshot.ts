import { adminClient, missingVariables, readSession } from './_runtime';

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
    const client = adminClient();
    if (!client) {
      response.status(503).json({ error: 'Supabase server access is not configured.', missing: missingVariables });
      return;
    }

    const requestedSince = typeof request.query?.since === 'string' ? request.query.since : '';
    const since = requestedSince && !Number.isNaN(Date.parse(requestedSince)) ? requestedSince : null;
    const syncCursor = new Date().toISOString();
    const withChangesSince = (query: any) => since ? query.gt('updated_at', since) : query;
    const tables = await Promise.all([
      withChangesSince(client.from('port_configs').select('*')),
      withChangesSince(client.from('depot_configs').select('*')),
      withChangesSince(client.from('companies').select('*')),
      withChangesSince(client.from('registration_submissions').select('*')).order('submitted_at', { ascending: false }),
      withChangesSince(client.from('user_registrations').select('id, username, email, type, company_id, company_name, full_name, mobile_number, created_at, updated_at')).order('created_at', { ascending: false }),
      since
        ? client.from('haulier_guidelines').select('content, updated_at').eq('id', 'default').gt('updated_at', since).maybeSingle()
        : client.from('haulier_guidelines').select('content, updated_at').eq('id', 'default').maybeSingle(),
    ]);
    const failed = tables.find((result: any) => result.error);
    if (failed?.error) {
      console.error('Snapshot database query failed:', failed.error);
      response.status(502).json({ error: 'Unable to load application data.' });
      return;
    }
    const [ports, depots, companies, submissions, userRegistrations, guideline] = tables as any[];
    response.status(200).json({
      ports: ports.data || [],
      depots: depots.data || [],
      companies: (companies.data || []).map((company: any) => ({ ...company.details, ...company, details: undefined })),
      submissions: submissions.data || [],
      userRegistrations: userRegistrations.data || [],
      guideline: guideline.data?.content || null,
      guidelineUpdatedAt: guideline.data?.updated_at || null,
      syncCursor,
    });
  } catch (error) {
    console.error('Snapshot function failed:', error);
    response.status(500).json({ error: 'Unable to load application data.' });
  }
}
