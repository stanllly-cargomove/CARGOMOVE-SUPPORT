import type { Recovery } from '../types/northport';

export function recoveryFlow(recovery: Recovery) {
  if (recovery.processing_result === 'Scheduler run observed — container import not verified') return {label:'SCHEDULER RUN OBSERVED',tone:'blue',step:3,description:'CargoMove Last run advanced after the scheduler request. A scheduler run was observed; container import is still not verified.'};
  if (recovery.status === 'Approved') return {label:'APPROVED · NOT UPLOADED',tone:'amber',step:1,description:'The file is approved and has not been uploaded. Resume reprocessing to upload the approved CSV and request Northport processing.'};
  if (recovery.status === 'Uploading') return {label:'UPLOAD IN PROGRESS',tone:'amber',step:1,description:'An upload has started. Refresh history to check its outcome before taking another action.'};
  if (recovery.status === 'Failed') return {label:'UPLOAD NEEDS REVIEW',tone:'rose',step:1,description:'The upload outcome needs operator review. Check FTP and the recovery audit before another upload.'};
  if (recovery.status === 'Scheduler Triggered' || recovery.scheduler_status === 'trigger_requested') return {label:'PROCESSING REQUESTED',tone:'blue',step:3,description:'The recovery file was uploaded and the scheduler request was accepted. Container import is not yet verified.'};
  if (recovery.scheduler_status || recovery.status === 'Verification Unavailable') return {label:'PROCESSING NEEDS REVIEW',tone:'amber',step:2,description:'The scheduler outcome is not confirmed. Check its execution record; do not upload the recovery file again.'};
  if (recovery.status === 'Uploaded') return {label:'UPLOADED · AWAITING PROCESSING',tone:'amber',step:2,description:'The recovery CSV is uploaded. Run the scheduler to request processing, or allow the regular schedule to pick it up.'};
  return {label:'STATUS NEEDS REVIEW',tone:'amber',step:0,description:'Refresh history and check the recovery audit to confirm the current stage.'};
}
