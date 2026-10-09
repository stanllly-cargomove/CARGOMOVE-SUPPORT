import { bodyOf, configuredClient, createSubmissionBatchPreviewToken, noStore, requireAdmin, sanitizeEmailHtml } from '../_email.js';
import { assetRegistrationPdfName } from './submission-asset-pdf.js';

const validEmail = (value: unknown) => {
  const email = String(value || '').trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '';
};
const escapeHtml = (value: unknown) => String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function recipientsFor(submission: any, company: any) {
  const values = [company?.contact_email, company?.details?.contact_email, submission.notification_email, ...(submission?.data?.email_confirmation?.recipients || []), submission.submitted_by_email];
  return Array.from(new Set(values.map(validEmail).filter(Boolean)));
}

function itemSummary(submission: any) {
  const data = submission.data || {};
  const items = submission.registration_type === 'DRIVER' ? (data.drivers || (data.driver ? [data.driver] : [])).map((item: any) => item.name || item.driving_license)
    : submission.registration_type === 'TRAILER' ? (data.trailers || (data.trailer ? [data.trailer] : [])).map((item: any) => item.registration_number)
      : (data.vehicles || (data.vehicle ? [data.vehicle] : [])).map((item: any) => item.registration_number);
  const type = submission.registration_type.charAt(0) + submission.registration_type.slice(1).toLowerCase();
  return `<li><strong>${escapeHtml(type)}</strong> — ${escapeHtml(items.filter(Boolean).join(', ') || submission.reference_no)} <span>(Ref: ${escapeHtml(submission.reference_no)})</span></li>`;
}

export default async function submissionBatchPreview(request: any, response: any) {
  noStore(response);
  if (request.method !== 'POST') return response.status(405).json({ error: 'Method not allowed.' });
  const session = requireAdmin(request, response); if (!session) return;
  const client = configuredClient(response); if (!client) return;
  const body: Record<string, unknown> = await bodyOf(request).catch(() => ({}));
  const ids = Array.from(new Set(Array.isArray(body.submissionIds) ? body.submissionIds.map((id) => String(id).trim()).filter(Boolean) : [])).slice(0, 100);
  if (!ids.length) return response.status(400).json({ error: 'Select at least one asset registration.' });
  const results = await Promise.all(ids.map((id) => client.from('registration_submissions').select('id,reference_no,registration_type,company_id,company_name,submitted_by_email,notification_email,data').eq('id', id).maybeSingle()));
  const resultError = results.find((result) => result.error)?.error;
  if (resultError) return response.status(502).json({ error: resultError.message });
  const submissions = results.map((result) => result.data).filter(Boolean);
  if (submissions.length !== ids.length || submissions.some((submission: any) => !['DRIVER', 'TRAILER', 'VEHICLE'].includes(submission.registration_type))) return response.status(400).json({ error: 'Only Driver, Trailer, and Vehicle registrations can be emailed together.' });
  const companyIds = Array.from(new Set(submissions.map((submission: any) => submission.company_id).filter(Boolean)));
  const companyResults = await Promise.all(companyIds.map((id) => client.from('companies').select('id,contact_email,details').eq('id', id).maybeSingle()));
  const companyError = companyResults.find((result) => result.error)?.error;
  if (companyError) return response.status(502).json({ error: companyError.message });
  const companies = new Map(companyResults.map((result) => result.data).filter(Boolean).map((company: any) => [company.id, company]));
  const grouped = new Map<string, any[]>();
  submissions.forEach((submission: any) => { const key = submission.company_id || submission.company_name; grouped.set(key, [...(grouped.get(key) || []), submission]); });
  const previews = Array.from(grouped.values()).map((group) => {
    const recipient = Array.from(new Set(group.flatMap((submission) => recipientsFor(submission, companies.get(submission.company_id))))).join(', ');
    if (!recipient) throw new Error(`No valid notification email is available for ${group[0].company_name}.`);
    const bodyHtml = `<p>Dear Customer,</p><p>The following CargoMove registrations for <strong>${escapeHtml(group[0].company_name)}</strong> have been approved and exported:</p><ul>${group.map(itemSummary).join('')}</ul><p>If you notice an issue, error, or incorrect registration data, please contact CargoMove Support through our official channels:</p><p><strong>Official WhatsApp:</strong> 018-266 0085<br><strong>Email:</strong> support@cargomove.com.my<br><strong>General Line:</strong> 03-2771 2765</p><p>Regards,<br>CargoMove</p>`;
    return { recipient, subject: `CargoMove registration approval — ${group[0].company_name}`, body: sanitizeEmailHtml(bodyHtml), templateName: `${group[0].company_name} — ${group.length} approved registration${group.length === 1 ? '' : 's'}`, attachments: [{ path: `/api/email/submission-attachment?submissionIds=${group.map((submission) => encodeURIComponent(submission.id)).join(',')}`, name: assetRegistrationPdfName(group), content_type: 'application/pdf', size: 0 }], previewToken: createSubmissionBatchPreviewToken(session, group.map((submission) => submission.id), recipient) };
  });
  response.json({ previews });
}
