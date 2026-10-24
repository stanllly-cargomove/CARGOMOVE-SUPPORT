import type { RegistrationSubmission } from '../types';
import { cacheSavedRegistration, refreshProtectedStorage, getCompanyById, getSubmissions } from './storage';
import { exportSubmissionsToExcel } from './excelExport';
import { assetCompanyBlockReason } from '../../shared/registration-eligibility';

interface UploadReply { submission: RegistrationSubmission; nextCheckMs: number; blocked?: boolean; download?: { filename: string; base64: string }; }
const inFlight = new Set<string>();

async function requestUpload(body: object): Promise<UploadReply> {
  // Mutations are sent once. A lost response is reconciled using the persisted job.
  const response = await fetch('/api/dev-tools/registration-uploads', {
    method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json', 'x-cargomove-confirm': 'registration-upload' },
    body: JSON.stringify(body),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || !result?.submission) throw new Error(result?.error || 'The CargoMove upload result could not be confirmed. Check the existing upload before retrying.');
  cacheSavedRegistration(null, result.submission);
  return result;
}

function downloadWorkbook(download: { filename: string; base64: string }) {
  const bytes = Uint8Array.from(atob(download.base64), character => character.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = download.filename;
  document.body.appendChild(anchor); anchor.click(); anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function checkRegistrationUpload(jobId: string): Promise<RegistrationSubmission> {
  return (await requestUpload({ action: 'check', jobId })).submission;
}

export async function generateRegistrationExcel(submissions: RegistrationSubmission[], onProgress: (message: string) => void = () => {}) {
  const verified: RegistrationSubmission[] = [];
  const problems: string[] = [];
  const pending = new Map<string, { reply: UploadReply; nextAt: number }>();
  const acquired: string[] = [];
  let count = 0;
  try {
    if (!submissions.length) throw new Error('No registrations selected.');
    if (submissions.some(sub => inFlight.has(sub.id))) throw new Error('An Excel upload for this registration is already running.');
    submissions.forEach(sub => { inFlight.add(sub.id); acquired.push(sub.id); });
    for (const submission of submissions) {
      onProgress(`${submission.reference_no}: generating Excel and uploading to CargoMove...`);
      try {
        if (submission.registration_type === 'COMPANY') {
          // Phase one automates only vehicle/trailer/driver uploads. Company export remains manual.
          const result = exportSubmissionsToExcel([submission], { customFilename: `${submission.reference_no}_COMPANY.xlsx` });
          if (!result.success) throw new Error(result.error || 'Excel generation failed.');
          verified.push(submission); count += result.count || 0;
          continue;
        }
        const blockReason = assetCompanyBlockReason(submission, getCompanyById(submission.company_id), getSubmissions());
        if (blockReason) { problems.push(`${submission.reference_no}: ${blockReason}`); continue; }
        let reply = await requestUpload({ action: 'start', submissionId: submission.id });
        if (reply.download) downloadWorkbook(reply.download);
        if (reply.submission.cargomove_upload?.state === 'UNKNOWN') {
          reply = await requestUpload({ action: 'check', jobId: reply.submission.cargomove_upload.id });
        }
        pending.set(submission.id, { reply, nextAt: 0 });
      } catch (error) {
        problems.push(`${submission.reference_no}: ${error instanceof Error ? error.message : 'CargoMove upload failed.'}`);
        await refreshProtectedStorage().catch(() => {});
      }
    }
    const deadline = Date.now() + 3 * 60000;
    while (pending.size && Date.now() < deadline) {
      for (const [id, item] of pending) {
        const summary = item.reply.submission.cargomove_upload;
        if (!summary) { problems.push(`${item.reply.submission.reference_no}: upload tracking is unavailable.`); pending.delete(id); continue; }
        onProgress(`${item.reply.submission.reference_no}: ${summary.message}`);
        if (item.reply.blocked) {
          problems.push(`${item.reply.submission.reference_no}: ${summary.message}`); pending.delete(id); continue;
        }
        if (summary.state === 'SUCCESS') {
          verified.push(item.reply.submission); count += summary.expectedRows; pending.delete(id); continue;
        }
        if (['FAILED', 'UNKNOWN'].includes(summary.state)) {
          problems.push(`${item.reply.submission.reference_no}: ${summary.message}`); pending.delete(id); continue;
        }
        if (Date.now() < item.nextAt) continue;
        try {
          item.reply = await requestUpload({ action: 'check', jobId: summary.id });
          item.nextAt = Date.now() + Math.max(1000, Math.min(30000, item.reply.nextCheckMs || 5000));
        } catch (error) {
          problems.push(`${item.reply.submission.reference_no}: ${error instanceof Error ? error.message : 'Verification was interrupted.'}`);
          pending.delete(id);
          await refreshProtectedStorage().catch(() => {});
        }
      }
      if (pending.size) await new Promise(resolve => window.setTimeout(resolve, 1000));
    }
    for (const item of pending.values()) problems.push(`${item.reply.submission.reference_no}: verification is still pending. Use the reference information button to check the existing file.`);
    return { success: problems.length === 0, count, verified, error: problems.join('\n') };
  } catch (error) {
    return { success: false, count, verified, error: error instanceof Error ? error.message : 'Excel upload failed.' };
  } finally {
    acquired.forEach(id => inFlight.delete(id));
    onProgress('');
  }
}
