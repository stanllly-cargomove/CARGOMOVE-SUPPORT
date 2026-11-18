import type { Recovery } from '../types/northport';

export function canRetryScheduler(recovery: Recovery): boolean {
  if (recovery.in_progress || recovery.manual_review?.outcome==='SUCCESS' || recovery.gp_verification?.status==='VERIFIED') return false;
  return ['Uploaded','Verification Unavailable'].includes(recovery.status)
    && (recovery.scheduler_status==='not_sent' || (recovery.scheduler_status==='failed'
      && recovery.scheduler_run?.status==='FAILED' && recovery.scheduler_run.dispatch_at===null));
}

export function recoveryFlow(recovery: Recovery) {
  if (recovery.in_progress) return {label:'PROCESSING',tone:'blue',step:recovery.status==='Uploaded'?2:1,description:'Recovery requested. The file is being prepared, uploaded and checked. Open these details for the latest result.'};
  if (canRetryScheduler(recovery)) return {label:'FAIL',tone:'red',step:2,description:'The recovery file is uploaded. No scheduler request was sent. Retry scheduler to continue without uploading again.'};
  if (recovery.manual_review) return {label:recovery.manual_review.outcome,tone:recovery.manual_review.outcome==='SUCCESS'?'green':'red',step:3,description:`Manually verified by ${recovery.manual_review.reviewedBy}. ${recovery.manual_review.note}`};
  if (recovery.status==='Cancelled' || recovery.status==='Approved') return {label:'CANCELLED',tone:'gray',step:recovery.status==='Approved'?1:0,description:recovery.status==='Approved'?'The file was approved but was not uploaded. No processing was completed.':'Recovery cancelled before upload. No file was sent to FTP.'};
  if (recovery.container_type==='GP' && recovery.gp_verification?.status==='VERIFIED') return {label:'SUCCESS',tone:'green',step:3,description:'The exact gatepass and container pair was found in CargoMove Northport Gatepasses.'};
  if (recovery.container_type==='GP' && recovery.gp_verification?.status==='NOT_FOUND') return {label:'FAIL',tone:'red',step:3,description:'The exact gatepass and container pair was not found after processing. You can check GP again without uploading or running the scheduler again.'};
  if (recovery.container_type==='EX' && recovery.export_verification?.status==='VERIFIED') return {label:'SUCCESS',tone:'green',step:3,description:'The Northport EXPORT row matched the approved container ID and SCN, with Updated at or after scheduler dispatch (two-minute clock tolerance).'};
  if (recovery.container_type==='EX' && ['NOT_FOUND','STALE'].includes(recovery.export_verification?.status||'')) return {label:'FAIL',tone:'red',step:3,description:recovery.export_verification?.status==='STALE'?'The matching Northport EXPORT container and SCN has an old Updated time. Check the container again before retrying recovery.':'No exact Northport EXPORT container and SCN row was found. Check the container again before retrying recovery.'};
  if (recovery.status==='Failed' || recovery.scheduler_status==='failed') return {label:'FAIL',tone:'red',step:recovery.status==='Failed'?1:2,description:recovery.status==='Failed'?'Recovery failed during upload. Check the recorded result and FTP before trying again.':'The scheduler request failed. Check its recorded result before trying again.'};
  if (recovery.container_type==='EX' && (recovery.scheduler_status || recovery.status==='Import Verified')) return {label:'PROCESSING',tone:'blue',step:3,description:'Export container verification is pending or unavailable. Check the exact Northport EXPORT container, SCN and Updated time in CargoMove; scheduler Last run alone does not verify this recovery.'};
  if (recovery.container_type==='GP' && recovery.gp_verification?.status==='UNAVAILABLE') return {label:'PROCESSING',tone:'blue',step:3,description:'The file was uploaded, but the GP result could not be checked. Check GP again to verify the exact gatepass and container pair.'};
  if (['Uploaded','Uploading','Processing','Scheduler Triggered','Verification Unavailable','Requested'].includes(recovery.status) || recovery.scheduler_status) return {label:'PROCESSING',tone:'blue',step:recovery.status==='Uploading'?1:recovery.scheduler_status?3:2,description:recovery.status==='Uploading'?'FTP upload is in progress. The result is not verified yet.':recovery.scheduler_status==='unknown'?'The file was uploaded, but the scheduler outcome is uncertain. Check its audit record; do not run it again automatically.':'The recovery file was uploaded. The processing result is not verified yet.'};
  return {label:'PROCESSING',tone:'blue',step:0,description:'The recovery result is not verified yet. Refresh these details to check the latest status.'};
}
