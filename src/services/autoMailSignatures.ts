export type MailSignature={id:string;name:string;html:string};
const key=(scope:string,mailbox:string)=>`cargomove.mail-signatures.v1:${encodeURIComponent(scope)}:${encodeURIComponent(mailbox)}`;
export function readMailSignatures(scope:string,mailbox:string):MailSignature[]{try{const value=JSON.parse(localStorage.getItem(key(scope,mailbox))||'[]');return Array.isArray(value)?value.filter(item=>item&&typeof item.id==='string'&&typeof item.name==='string'&&typeof item.html==='string').slice(0,20):[];}catch{return [];}}
export function saveMailSignatures(scope:string,mailbox:string,items:MailSignature[]){localStorage.setItem(key(scope,mailbox),JSON.stringify(items));window.dispatchEvent(new Event('cargomove:mail-signatures'));}
