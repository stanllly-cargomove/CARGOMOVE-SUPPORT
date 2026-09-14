import { adminClient, missingVariables } from '../../api/_runtime.js';

// Accept existing four-digit references as well as the stronger references
// generated for new registrations.
const REFERENCE_PATTERN = /^REG-\d{8}-[A-Z0-9]{4,16}$/;

async function deriveTrackingFromWorkflow(client: NonNullable<ReturnType<typeof adminClient>>, referenceNo: string) {
  const submissionResult = await client
    .from('registration_submissions')
    .select('reference_no,registration_type,company_id,company_name,port_location,status,submitted_at,reviewed_at,updated_at')
    .eq('reference_no', referenceNo)
    .maybeSingle();

  if (submissionResult.error) return { data: null, error: submissionResult.error };
  const submission = submissionResult.data;
  if (!submission) return { data: null, error: null };

  let userEmailSent = false;
  let userUpdatedAt: string | null = null;
  if (submission.registration_type === 'COMPANY' && submission.company_id) {
    let userResult = await client
      .from('external_user_access')
      .select('email_sent,email_status,updated_at')
      .eq('company_id', submission.company_id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    // Keep tracking operational while an older installation is still applying
    // the email_status migration. email_sent was present in the original table.
    if (userResult.error && JSON.stringify(userResult.error).toLowerCase().includes('email_status')) {
      userResult = await client
        .from('external_user_access')
        .select('email_sent,updated_at')
        .eq('company_id', submission.company_id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
    }
    if (userResult.error) return { data: null, error: userResult.error };
    userEmailSent = userResult.data?.email_sent === 1
      && (!userResult.data.email_status || userResult.data.email_status === 'SENT');
    userUpdatedAt = userResult.data?.updated_at || null;
  }

  const status = submission.status === 'REJECTED'
    ? 'REJECTED'
    : submission.status === 'DONE'
      && (submission.registration_type !== 'COMPANY' || userEmailSent)
      ? 'SUCCESS'
      : 'PENDING';

  return {
    data: {
      reference_no: submission.reference_no,
      registration_type: submission.registration_type,
      company_name: submission.company_name,
      port_location: submission.port_location,
      status,
      submission_status: submission.status,
      user_email_sent: userEmailSent,
      submitted_at: submission.submitted_at,
      completed_at: status === 'SUCCESS'
        ? userUpdatedAt || submission.reviewed_at || submission.updated_at
        : null,
      updated_at: userUpdatedAt || submission.updated_at,
    },
    error: null,
  };
}

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

  const trackingResult = await client
    .from('registration_tracking')
    .select('reference_no,registration_type,company_name,port_location,status,submission_status,user_email_sent,submitted_at,completed_at,updated_at')
    .eq('reference_no', referenceNo)
    .maybeSingle();

  if (!trackingResult.error && trackingResult.data) {
    response.json({ tracking: trackingResult.data });
    return;
  }

  if (trackingResult.error) {
    console.warn('Registration tracking table unavailable; using workflow fallback:', trackingResult.error);
  }

  const fallbackResult = await deriveTrackingFromWorkflow(client, referenceNo);
  if (fallbackResult.error) {
    console.error('Registration workflow lookup failed:', fallbackResult.error);
    response.status(502).json({ error: 'Unable to check the registration status right now.' });
    return;
  }

  response.json({ tracking: fallbackResult.data });
}
