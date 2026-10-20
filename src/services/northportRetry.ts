import type { Recovery, RecoverySearchSetup } from '../types/northport';

export function recoveryRetrySetup(recovery:Recovery):{setup:RecoverySearchSetup;restored:boolean} {
  if(recovery.search_setup) return {setup:{...recovery.search_setup,unit:recovery.container,type:recovery.container_type},restored:true};
  const match=recovery.source_filename.match(/^CM_CONTAINER_(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})_(GP|EX)\.csv$/i);
  if(!match)throw new Error('Search setup was not saved. Enter the container and EIR time in the search card.');
  return {setup:{unit:recovery.container,timestamp:`${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}`,type:recovery.container_type,before:10,after:30,sourceFilename:recovery.source_filename,mode:'standard'},restored:false};
}
