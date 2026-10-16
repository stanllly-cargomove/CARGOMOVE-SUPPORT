import test from 'node:test';
import assert from 'node:assert/strict';
import { reprocessApprovedRecovery, ReprocessError, type ReprocessSubmission } from '../src/services/northportReprocess.js';
const submission:ReprocessSubmission={id:'approved-id',token:'signed-source',values:['CONTAINER123',...Array(19).fill('')],approved:true,identityConfirmed:false};
test('Reprocess uploads once, waits for admission, and triggers the existing audited scheduler action with only the recovery ID',async()=>{
  const events:string[]=[];
  const result=await reprocessApprovedRecovery(submission,{
    post:async(action,body)=>{
      events.push(action);
      if(action==='upload'){assert.deepEqual(body,submission);return {status:'Uploaded'};}
      assert.deepEqual(body,{id:submission.id});return {status:'Scheduler Triggered',executionId:'existing-run',processingResult:'Verification Unavailable'};
    },onUploaded:()=>events.push('uploaded'),pause:async()=>{events.push('wait');},onScheduler:()=>events.push('dispatch'),
  });
  assert.deepEqual(events,['upload','uploaded','wait','dispatch','scheduler']);assert.equal(result.executionId,'existing-run');assert.equal(result.processingResult,'Verification Unavailable');
});
test('upload failure or an unconfirmed upload never dispatches the scheduler',async()=>{
  for(const fail of [true,false]) {
    const events:string[]=[];
    await assert.rejects(()=>reprocessApprovedRecovery(submission,{
      post:async(action)=>{events.push(action);if(fail)throw new Error('Upload failed');return {status:'Unknown'};},pause:async()=>{},
    }),error=>error instanceof ReprocessError&&!error.uploaded&&error.recoveryId===submission.id&&/Check recovery history and FTP/.test(error.message));
    assert.deepEqual(events,['upload']);
  }
});
test('scheduler failures preserve uploaded status and never repeat the upload or scheduler mutation',async()=>{
  for(const reject of [true,false]) {
    const events:string[]=[];
    await assert.rejects(()=>reprocessApprovedRecovery(submission,{
      post:async(action)=>{events.push(action);if(action==='upload')return {status:'Uploaded'};if(reject)throw new Error('Scheduler cooldown');return {status:'Verification Unavailable',message:'Dispatch uncertain'};},pause:async()=>{},
    }),error=>error instanceof ReprocessError&&error.uploaded&&/Do not upload the file again/.test(error.message));
    assert.deepEqual(events,['upload','scheduler']);
  }
});
