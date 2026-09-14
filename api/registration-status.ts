import { adminClient, missingVariables } from './_runtime.js';

// Accept existing four-digit references as well as the stronger references
// generated for new registrations.
const REFERENCE_PATTERN = /^REG-\d{8}-[A-Z0-9]{4,16}$/;

export default async function registrationStatus(request: any, response: any) {
  response.setHeader('Cache-Control', 'no-store, max-age=0');
  if (request.method !== 'GET') {
    response.status(405).json({ error: 'Method not allowed.' });
    return;
  }

  const client = adminClient();
  if (!client) {
    response.status(503).json({ error: 'Registration tracking is unavailable.', missing: missingVariables });
    return;
  }

  const referenceNo = String(request.query?.reference_no || '').trim().toUpperCase();
  if (!REFERENCE_PATTERN.test(referenceNo)) {
    response.status(400).json({ error: 'Enter a valid registration reference number.' });
    return;
  }

  const { data, error } = await client
    .from('registration_tracking')
    .select('reference_no,registration_type,company_name,port_location,status,submission_status,user_email_sent,submitted_at,completed_at,updated_at')
    .eq('reference_no', referenceNo)
    .maybeSingle();

  if (error) {
    console.error('Registration tracking lookup failed:', error);
    response.status(502).json({ error: 'Unable to check the registration status right now.' });
    return;
  }

  response.json({ tracking: data || null });
}
