import type { RegistrationSubmission } from '../types';
import { cacheSavedRegistration, refreshProtectedStorage, getCompanyById, getSubmissions } from './storage';
import { exportSubmissionsToExcel, validateSubmissionsForExport } from './excelExport';
import { assetCompanyBlockReason } from '../../shared/registration-eligibility';

interface UploadReply { submission: RegistrationSubmission; submissions?: RegistrationSubmission[]; incomplete?: string[]; nextCheckMs: number; blocked?: boolean; download?: { filename: string; base64: string }; }
const inFlight = new Set<string>();

async function requestUpload(body: object): Promise<UploadReply> {
  // Mutations are sent once. A lost response is reconciled using the persisted job.
  const response = await fetch('/api/dev-tools/registration-uploads', {
    method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json', 'x-cargomove-confirm': 'registration-upload' },
    body: JSON.stringify(body),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || !result?.submission) throw new Error(result?.error || 'The CargoMove upload result could not be confirmed. Check the existing upload before retrying.');
  (result.submissions || [result.submission]).forEach((sub: RegistrationSubmission) => cacheSavedRegistration(null, sub));
  return result;
}

function downloadWorkbook(download: { filename: string; base64: string }) {
  const bytes = Uint8Array.from(atob(download.base64), character => character.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = download.filename.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-');
  document.body.appendChild(anchor); anchor.click(); anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function checkRegistrationUpload(jobId: string): Promise<RegistrationSubmission> {
  return (await requestUpload({ action: 'check', jobId })).submission;
}

export async function generateRegistrationExcel(submissions: RegistrationSubmission[], onProgress: (message: string) => void = () => {}) {
  const verified: RegistrationSubmission[] = [];
  const downloaded: RegistrationSubmission[] = [];
  const problems: string[] = [];
  const acquired: string[] = [];
  const pending = new Map<string, { reply: UploadReply; ids: Set<string>; nextAt: number }>();
  let count = 0;
  try {
    if (!submissions.length) throw new Error('No registrations selected.');
    if (submissions.some(sub => inFlight.has(sub.id))) throw new Error('An upload for this selection is already running.');
    submissions.forEach(sub => { inFlight.add(sub.id); acquired.push(sub.id); });
    const groups = new Map<string, RegistrationSubmission[]>();
    for (const sub of submissions) {
      const block = assetCompanyBlockReason(sub, getCompanyById(sub.company_id), getSubmissions());
      const validation = validateSubmissionsForExport([sub]);
      if (block || !validation.valid) { problems.push(`${sub.reference_no}: ${block || validation.errors.join(' ')}`); continue; }
      // Check a previous physical upload once, even if only some of its references are selected.
      const summary = sub.cargomove_upload;
      const resume = summary && (summary.state !== 'FAILED' || (summary.successCount ?? 0) > 0 || summary.expectedRows > 0 && summary.successCount == null);
      const key = resume ? summary.id : sub.registration_type;
      groups.set(key, [...(groups.get(key) || []), sub]);
    }
    for (const group of groups.values()) {
      onProgress(`Preparing ${group.length} selected registration(s)...`);
      try {
        if (group[0].registration_type === 'COMPANY') {
          // Company data-entry automation remains outside phase one.
          const result = exportSubmissionsToExcel(group, { downloadOnly: true });
          if (!result.success) throw new Error(result.error);
          downloaded.push(...group); count += group.length;
          continue;
        }
        const summary = group[0].cargomove_upload;
        const resume = summary && (summary.state !== 'FAILED' || (summary.successCount ?? 0) > 0 || summary.expectedRows > 0 && summary.successCount == null);
        let reply = await requestUpload(resume ? { action: 'check', jobId: summary.id }
          : { action: 'start', submissionIds: group.map(sub => sub.id) });
        if (reply.download) downloadWorkbook(reply.download);
        problems.push(...(reply.incomplete || []));
        if (!resume && reply.submission.cargomove_upload?.state === 'UNKNOWN') {
          reply = await requestUpload({ action: 'check', jobId: reply.submission.cargomove_upload.id });
        }
        const jobId = reply.submission.cargomove_upload?.id;
        if (!jobId) throw new Error('Upload tracking is unavailable.');
        pending.set(jobId, { reply, ids: new Set(group.map(sub => sub.id)), nextAt: 0 });
      } catch (error) {
        problems.push(...group.map(sub => `${sub.reference_no}: ${error instanceof Error ? error.message : 'Upload interrupted.'}`));
        await refreshProtectedStorage().catch(() => {});
      }
    }
    const deadline = Date.now() + 3 * 60000;
    while (pending.size && Date.now() < deadline) {
      for (const [id, item] of pending) {
        const summary = item.reply.submission.cargomove_upload!;
        const members = (item.reply.submissions || [item.reply.submission]).filter(sub => item.ids.has(sub.id));
        onProgress(`${verified.length} successful; checking ${summary.filename}...`);
        if (summary.state === 'SUCCESS') {
          verified.push(...members); count += members.length; pending.delete(id); continue;
        }
        if (item.reply.blocked || ['FAILED', 'UNKNOWN'].includes(summary.state)) {
          problems.push(...members.map(sub => `${sub.reference_no}: ${summary.message}`)); pending.delete(id); continue;
        }
        if (Date.now() < item.nextAt) continue;
        try {
          item.reply = await requestUpload({ action: 'check', jobId: id });
          item.nextAt = Date.now() + Math.max(1000, Math.min(30000, item.reply.nextCheckMs || 5000));
        } catch (error) {
          problems.push(...members.map(sub => `${sub.reference_no}: ${error instanceof Error ? error.message : 'Verification interrupted.'}`));
          pending.delete(id); await refreshProtectedStorage().catch(() => {});
        }
      }
      if (pending.size) await new Promise(resolve => window.setTimeout(resolve, 1000));
    }
    for (const item of pending.values()) problems.push(...submissions.filter(sub => item.ids.has(sub.id)).map(sub => `${sub.reference_no}: verification is still pending. Check the existing file using the reference information button.`));
  } catch (error) {
    problems.push(error instanceof Error ? error.message : 'Excel upload failed.');
  } finally {
    acquired.forEach(id => inFlight.delete(id)); onProgress('');
  }
  return { success: problems.length === 0, count, verified, downloaded, incompleteCount: submissions.length - verified.length - downloaded.length, error: problems.join('\n') };
}
