import { adminClient, missingVariables } from '../../api/_runtime.js';

const publicCompanyFields = [
  'id',
  'registration_number',
  'registration_number_old',
  'registration_number_new',
  'name',
  'short_name',
  'company_type',
  'haulier_id',
  'forwarding_agent_id',
  'port_id',
  'depot_id',
  'status',
  'created_at',
  'updated_at',
].join(',');

export default async function companyLookup(request: any, response: any) {
  response.setHeader('Cache-Control', 'no-store, max-age=0');
  if (request.method !== 'GET') {
    response.status(405).json({ error: 'Method not allowed.' });
    return;
  }

  const client = adminClient();
  if (!client) {
    response.status(503).json({ error: 'Supabase server access is not configured.', missing: missingVariables });
    return;
  }

  const registrationNumber = String(request.query?.registration_number || '').trim();
  if (!registrationNumber || registrationNumber.length > 64) {
    response.status(400).json({ error: 'A valid company registration number is required.' });
    return;
  }

  // Company registration numbers are exact identifiers. Try the entered and
  // normalized letter cases without exposing a browsable company directory.
  const values = Array.from(new Set([registrationNumber, registrationNumber.toUpperCase(), registrationNumber.toLowerCase()]));
  const columns = ['registration_number', 'registration_number_old', 'registration_number_new'];

  for (const column of columns) {
    for (const value of values) {
      const result = await client.from('companies')
        .select(publicCompanyFields)
        .eq(column, value)
        .maybeSingle();
      if (result.error) {
        console.error('Company lookup failed:', result.error);
        response.status(502).json({ error: 'Unable to verify the company right now.' });
        return;
      }
      if (result.data) {
        response.status(200).json({ company: result.data });
        return;
      }
    }
  }

  response.status(200).json({ company: null });
}
