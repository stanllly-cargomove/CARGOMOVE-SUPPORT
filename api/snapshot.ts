import { adminClient, missingVariables, readSession } from './_runtime';

export default async function snapshot(request: any, response: any) {
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
  const tables = await Promise.all([
    client.from('port_configs').select('*'),
    client.from('depot_configs').select('*'),
    client.from('companies').select('*'),
    client.from('registration_submissions').select('*').order('submitted_at', { ascending: false }),
    client.from('user_registrations').select('id, username, email, type, company_id, company_name, full_name, mobile_number, created_at, updated_at').order('created_at', { ascending: false }),
    client.from('haulier_guidelines').select('content').eq('id', 'default').maybeSingle(),
  ]);
  const failed = tables.find((result) => result.error);
  if (failed?.error) {
    response.status(502).json({ error: failed.error.message });
    return;
  }
  const [ports, depots, companies, submissions, userRegistrations, guideline] = tables;
  response.json({
    ports: ports.data || [],
    depots: depots.data || [],
    companies: (companies.data || []).map((company: any) => ({ ...company.details, ...company, details: undefined })),
    submissions: submissions.data || [],
    userRegistrations: userRegistrations.data || [],
    guideline: (guideline as any).data?.content || null,
  });
}
