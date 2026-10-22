import { bodyOf, noStore, requireAdmin } from '../_email.js';
import { autoMailClient, autoMailConfiguration } from './configuration.js';
import { accessToken, checkOrigin, connected, googleJson, MODIFY_SCOPE } from './gmail.js';
import { MailError } from './mail-error.js';

export default async function mailboxActions(request:any,response:any) {
  noStore(response); const session=requireAdmin(request,response); if(!session)return;
  if(request.method!=='POST')return response.status(405).json({error:'Method not allowed.'});
  try {
    checkOrigin(request); const config=autoMailConfiguration(); if(!config.ready)throw new MailError(503,config.message);
    const body:any=await bodyOf(request);
    if(!['trash','restore'].includes(body.action)||!Array.isArray(body.ids)||!body.ids.length||body.ids.length>25||new Set(body.ids).size!==body.ids.length||body.ids.some((id:any)=>typeof id!=='string'||!/^[a-zA-Z0-9_-]{1,128}$/.test(id)))throw new MailError(400,'Select up to 25 conversations.');
    const connection=await connected(autoMailClient(config));
    if(body.connectionVersion!==connection.version)throw new MailError(409,'The connected mailbox changed. Refresh before managing mail.');
    if(!connection.scopes.includes(MODIFY_SCOPE))throw new MailError(409,'Reconnect Gmail and approve mailbox management to move or restore conversations.');
    const token=await accessToken(connection); const completed:string[]=[];const failed:string[]=[];
    // At most 25 calls in parallel; return per-thread results on partial failure.
    await Promise.all(body.ids.map(async(id:string)=>{
      try {await googleJson(`https://gmail.googleapis.com/gmail/v1/users/me/threads/${id}/${body.action==='trash'?'trash':'untrash'}`,{method:'POST',headers:{Authorization:`Bearer ${token}`}});completed.push(id);}catch{failed.push(id);}
    }));
    return response.json({completed,failed});
  }catch(error){return response.status(error instanceof MailError?error.status:503).json({error:error instanceof MailError?error.message:'Unable to manage Gmail conversations.'});}
}
