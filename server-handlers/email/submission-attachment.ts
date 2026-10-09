import { configuredClient, noStore, requireAdmin } from '../_email.js';
import { assetRegistrationPdfName, buildAssetRegistrationPdf } from './submission-asset-pdf.js';

export default async function submissionAttachment(request: any, response: any) {
  noStore(response);
  if (request.method !== 'GET') return response.status(405).json({ error: 'Method not allowed.' });
  if (!requireAdmin(request, response)) return;
  const client = configuredClient(response); if (!client) return;
  const ids = String(request.query?.submissionIds || '').split(',').map((id) => id.trim()).filter(Boolean).slice(0, 100);
  if (!ids.length) return response.status(400).json({ error: 'A registration queue number is required.' });
  const results = await Promise.all(ids.map((id) => client.from('registration_submissions').select('reference_no,registration_type,company_name,data').eq('id', id).maybeSingle()));
  const error = results.find((result) => result.error)?.error;
  const submissions = results.map((result) => result.data).filter(Boolean);
  if (error) return response.status(502).json({ error: error.message });
  if (submissions.length !== ids.length || submissions.some((submission: any) => !['DRIVER', 'TRAILER', 'VEHICLE'].includes(submission.registration_type))) return response.status(404).json({ error: 'Asset registration not found.' });
  const filename = assetRegistrationPdfName(submissions);
  response.setHeader('Content-Type', 'application/pdf');
  response.setHeader('Content-Disposition', request.query?.download === '1' ? `attachment; filename="${filename}"` : `inline; filename="${filename}"`);
  response.send(buildAssetRegistrationPdf(submissions[0].company_name, submissions));
}
