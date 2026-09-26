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

  // Match registration numbers regardless of case, spaces, or optional dash
  // formatting without exposing a browsable company directory.
  const compact = registrationNumber.replace(/[\s-]+/g, '').toUpperCase();
  const formatted = compact.length > 1 ? `${compact.slice(0, -1)}-${compact.slice(-1)}` : compact;
  const values = Array.from(new Set([
    registrationNumber,
    registrationNumber.toUpperCase(),
    registrationNumber.toLowerCase(),
    compact,
    compact.toLowerCase(),
    formatted,
    formatted.toLowerCase(),
  ]));
  const hasLetters = /[A-Z]/.test(compact);
  const columns = hasLetters
    ? ['registration_number_old', 'registration_number']
    : ['registration_number_new', 'registration_number', 'registration_number_old'];

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

  // Final normalized fallback for legacy records whose punctuation differs
  // from every generated candidate (for example 52-1668-P vs 521668P).
  const fallback = await client.from('companies')
    .select(publicCompanyFields)
    .limit(1000);
  if (!fallback.error && fallback.data) {
    const normalizedQuery = compact.replace(/[^A-Z0-9]/g, '');
    const match = fallback.data.find((company: Record<string, unknown>) => [
      company.registration_number_old,
      company.registration_number,
      company.registration_number_new,
    ].some((value) => String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '') === normalizedQuery));
    if (match) {
      response.status(200).json({ company: match });
      return;
    }
  }

  response.status(200).json({ company: null });
}
