export type ReprocessSubmission = {
  id:string;
  token:string;
  values:string[];
  approved:true;
  identityConfirmed:boolean;
};
type OperationResult = {status:string;message?:string;executionId?:string;processingResult?:string};
type ReprocessOperations = {
  post:(action:'upload'|'scheduler',body:Record<string,unknown>)=>Promise<OperationResult>;
  onUploaded?:()=>void;
  onScheduler?:()=>void;
  pause?:()=>Promise<void>;
};
export class ReprocessError extends Error {
  constructor(message:string,public uploaded:boolean,public recoveryId:string) {super(message);}
}

// Separate audited requests keep FTP transfer and browser scheduler execution
// within their existing function budgets. Never retry either mutation here.
export async function reprocessApprovedRecovery(submission:ReprocessSubmission,operations:ReprocessOperations) {
  let uploaded=false;
  try {
    const result=await operations.post('upload',submission);
    if(result.status!=='Uploaded')throw new Error(result.message||'Upload was not confirmed.');
    uploaded=true;
    operations.onUploaded?.();
    // Every POST shares the existing administrator rate limit.
    await (operations.pause?.()||new Promise<void>(resolve=>setTimeout(resolve,5100)));
    operations.onScheduler?.();
    const scheduler=await operations.post('scheduler',{id:submission.id});
    if(scheduler.status!=='Scheduler Triggered')throw new Error(scheduler.message||'Scheduler trigger was not confirmed.');
    return scheduler;
  } catch(error) {
    const detail=error instanceof Error?error.message:'The request did not complete.';
    throw new ReprocessError(uploaded
      ? `Recovery File Uploaded, but the Northport scheduler was not confirmed: ${detail} Check recovery history and the scheduler audit. Do not upload the file again.`
      : `Reprocess stopped before upload could be confirmed: ${detail} Check recovery history and FTP before retrying.`,uploaded,submission.id);
  }
}
