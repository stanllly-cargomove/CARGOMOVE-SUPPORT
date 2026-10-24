import { AutoMailSnackbar, AutoMailSnackbarArea } from './AutoMailSnackbar';
import React, { useEffect, useRef, useState } from 'react';
import { Trash2, MoreVertical, Clock, PenLine, Reply, AlignCenter, AlignLeft, AlignRight, Bold, Italic, Link, List, ListOrdered, Paperclip, Redo2, RemoveFormatting, Send, Strikethrough, Underline, Undo2, X } from 'lucide-react';
import { AutoMailAiPreview } from './AutoMailAiPreview';
import { AutoMailRecipientInput } from './AutoMailRecipientInput';
import { AutoMailFormatPicker } from './AutoMailFormatPicker';
import { readMailSignatures } from '../../services/autoMailSignatures';
import type { MailRecipient } from '../../services/autoMailRecipients';
import { AutoMailRecipients } from './AutoMailRecipients';
import { knowledgeRequest } from '../../services/autoMailKnowledge';
import { browserMailHtml, browserMailText, escapeMailText, fileSize, plainMailHtml } from '../../services/autoMailFormatting';

export type ReplyUpload = { id: string; name: string; type: string; size: number };
type Props = {
  contacts?:MailRecipient[]; signatureScope?:string; onManageSignatures?:()=>void;
  onDiscard?:()=>void; schedulerReady?:boolean; onSchedule?:(sendAt:string)=>void;

  onAiPendingChange?:(pending:boolean)=>void;
  helpers?: {knowledge?:React.ReactNode;ai?:React.ReactNode}; responseMode?: 'reply'|'reply-all'; onReply?:()=>void; onForward?:()=>void;
  mode?: 'compose'; subject?: string; onSubject?: (value:string)=>void; extraActions?: React.ReactNode;
  body: string; html: string; onChange: (text:string,html:string)=>void;
  to: string; cc: string; bcc: string; onRecipients: (field:'to'|'cc'|'bcc',value:string)=>void;
  replyAll: {to:string[];cc:string[]}; onReplyAll: ()=>void; mailbox:string;
  files:ReplyUpload[];onFiles:(files:ReplyUpload[])=>void;
  requestId:string;threadId:string;sourceMessageId:string;connectionVersion:string;
  richReady:boolean;disabled:boolean;sending:boolean;onSend:()=>void;onBusyChange:(busy:boolean)=>void;
};
export function AutoMailComposer(props:Props){
  const [aiTarget,setAiTarget]=useState<HTMLDivElement|null>(null);
  const [aiPending,setAiPending]=useState(false);
  useEffect(()=>{props.onAiPendingChange?.(aiPending);return()=>props.onAiPendingChange?.(false);},[aiPending,props.onAiPendingChange]);
  const [alignment,setAlignment]=useState('justifyLeft');const[discarding,setDiscarding]=useState(false);
  const [font,setFont]=useState('Arial');const[fontSize,setFontSize]=useState('3');
  const [sendMenu,setSendMenu]=useState(false);const [signatureMenu,setSignatureMenu]=useState(false);const [scheduleAt,setScheduleAt]=useState('');const[scheduleError,setScheduleError]=useState('');const scheduleDialog=useRef<HTMLDialogElement>(null);const sendMenuRef=useRef<HTMLDivElement>(null);const signatureMenuRef=useRef<HTMLDivElement>(null);
  useEffect(()=>{const close=(event:PointerEvent)=>{if(!sendMenuRef.current?.contains(event.target as Node))setSendMenu(false);if(!signatureMenuRef.current?.contains(event.target as Node))setSignatureMenu(false);};document.addEventListener('pointerdown',close);return()=>document.removeEventListener('pointerdown',close);},[]);
  const [signatures,setSignatures]=useState(()=>readMailSignatures(props.signatureScope||props.mailbox,props.mailbox));
  useEffect(()=>{const refresh=()=>setSignatures(readMailSignatures(props.signatureScope||props.mailbox,props.mailbox));refresh();window.addEventListener('cargomove:mail-signatures',refresh);return()=>window.removeEventListener('cargomove:mail-signatures',refresh);},[props.signatureScope,props.mailbox]);
  const [helper,setHelper]=useState<'ai'|'knowledge'|null>(props.helpers?.ai?'ai':null);
  const editor=useRef<HTMLDivElement>(null);const picker=useRef<HTMLInputElement>(null);
  const imagePreviews=useRef(new Map<string,string>());
  useEffect(()=>()=>{imagePreviews.current.forEach(url=>URL.revokeObjectURL(url));imagePreviews.current.clear();},[]);
  const showImagePreviews=()=>editor.current?.querySelectorAll<HTMLImageElement>('img[data-mail-image]').forEach(image=>{const url=imagePreviews.current.get(image.getAttribute('data-mail-image')||'');if(url)image.src=url;});
  const [showCc,setShowCc]=useState(false);const [showBcc,setShowBcc]=useState(false);const [error,setError]=useState('');const [uploading,setUploading]=useState(false);
  const [linkOpen,setLinkOpen]=useState(false);const [linkUrl,setLinkUrl]=useState('');const [linkText,setLinkText]=useState('');const savedRange=useRef<Range|null>(null);
  useEffect(()=>{const html=props.html||(props.body?plainMailHtml(props.body):'');if(editor.current&&browserMailHtml(editor.current.innerHTML)!==browserMailHtml(html))editor.current.innerHTML=browserMailHtml(html);showImagePreviews();},[props.html,props.richReady]);
  useEffect(()=>{
    const controller=new AbortController();
    for(const file of props.files){
      const ref=`cid:upload-${file.id}@auto-mail`;
      if(!/^image\/(png|jpeg|gif|webp)$/.test(file.type)||imagePreviews.current.has(ref)||!Array.from(editor.current?.querySelectorAll('img[data-mail-image]')||[]).some(image=>image.getAttribute('data-mail-image')===ref))continue;
      const query=new URLSearchParams({id:file.id,requestId:props.requestId,threadId:props.threadId,sourceMessageId:props.sourceMessageId,connectionVersion:props.connectionVersion});
      void knowledgeRequest<{url:string}>(`draft-attachment?${query}`,undefined,controller.signal).then(result=>{if(!controller.signal.aborted){imagePreviews.current.set(ref,result.url);showImagePreviews();}}).catch(()=>{if(!controller.signal.aborted)setError('A draft image could not be previewed. It remains attached.');});
    }
    return()=>controller.abort();
  },[props.files,props.requestId,props.threadId,props.sourceMessageId,props.connectionVersion]);
  const rememberSelection=()=>{const selection=window.getSelection();if(selection?.rangeCount&&editor.current?.contains(selection.getRangeAt(0).commonAncestorContainer))savedRange.current=selection.getRangeAt(0).cloneRange();};
  const restoreSelection=()=>{editor.current?.focus();if(savedRange.current&&editor.current?.contains(savedRange.current.commonAncestorContainer)){const selection=window.getSelection();selection?.removeAllRanges();selection?.addRange(savedRange.current);}};
  const insertSignature=(html:string)=>{editor.current?.querySelector('[data-mail-signature]')?.remove();if(html&&editor.current){const node=document.createElement('div');node.setAttribute('data-mail-signature','true');node.innerHTML='<br>'+browserMailHtml(html);editor.current.append(node);}emit();setSignatureMenu(false);};
  const emit=()=>{const html=browserMailHtml(editor.current?.innerHTML||'');props.onChange(browserMailText(html),html);};
  const command=(name:string,value?:string)=>{editor.current?.focus();document.execCommand(name,false,value);emit();};
  const upload=async(list:FileList|File[]|null,inline=false)=>{
    if(!list||uploading)return;setError('');
    const files=Array.from(list);if(files.length+props.files.length>10||files.reduce((sum,f)=>sum+f.size,0)+props.files.reduce((sum,f)=>sum+f.size,0)>15*1024*1024){setError('Use up to 10 files and 15 MB in total.');return;}
    setUploading(true);props.onBusyChange(true);const ready=[...props.files];
    try{
      for(const file of files){
        const registered=await knowledgeRequest<ReplyUpload&{uploadUrl:string}>('attachment-upload',{name:file.name,size:file.size,requestId:props.requestId,threadId:props.threadId,sourceMessageId:props.sourceMessageId,connectionVersion:props.connectionVersion});
        try{
          const response=await fetch(registered.uploadUrl,{method:'PUT',headers:{'Content-Type':registered.type,'x-upsert':'false','cache-control':'max-age=0'},body:file,credentials:'omit'});
          if(!response.ok)throw new Error('Upload failed. Try attaching the file again.');
          ready.push({id:registered.id,name:registered.name,type:registered.type,size:registered.size});props.onFiles([...ready]);
          if(inline&&/^image\/(png|jpeg|gif|webp)$/.test(registered.type)){
            const ref=`cid:upload-${registered.id}@auto-mail`;
            imagePreviews.current.set(ref,URL.createObjectURL(file));
            const root=editor.current;if(!root)continue;
            const range=savedRange.current&&root.contains(savedRange.current.commonAncestorContainer)?savedRange.current.cloneRange():document.createRange();
            if(!savedRange.current||!root.contains(range.commonAncestorContainer)){range.selectNodeContents(root);range.collapse(false);}
            const image=document.createElement('img');image.setAttribute('data-mail-image',ref);image.alt=registered.name;
            range.deleteContents();range.insertNode(image);range.setStartAfter(image);range.collapse(true);savedRange.current=range;
            const selection=window.getSelection();selection?.removeAllRanges();selection?.addRange(range);emit();showImagePreviews();
          }
        }catch(reason){await knowledgeRequest('attachment-remove',{id:registered.id}).catch(()=>{});throw reason;}
      }
    }catch(reason){setError(reason instanceof Error?reason.message:'Unable to attach file.');}
    finally{setUploading(false);props.onBusyChange(false);if(picker.current)picker.current.value='';}
  };
  const paste=(event:React.ClipboardEvent<HTMLDivElement>)=>{
    event.preventDefault();if(disabled)return;
    const files=Array.from(event.clipboardData.files);
    if(files.length){
      const images=files.filter(file=>/^image\/(png|jpeg|gif|webp)$/.test(file.type));
      if(images.length!==files.length){setError('Paste PNG, JPEG, GIF or WebP images. Use Attach files for other formats.');return;}
      rememberSelection();
      const named=images.map(file=>new File([file],`pasted-image-${crypto.randomUUID()}.${file.type==='image/jpeg'?'jpg':file.type.split('/')[1]}`,{type:file.type}));
      void upload(named,true);return;
    }
    const html=event.clipboardData.getData('text/html');command('insertHTML',html?browserMailHtml(html):escapeMailText(event.clipboardData.getData('text/plain')).replaceAll('\n','<br>'));
  };
  const remove=async(file:ReplyUpload)=>{setError('');props.onBusyChange(true);try{await knowledgeRequest('attachment-remove',{id:file.id});props.onFiles(props.files.filter(item=>item.id!==file.id));const ref=`cid:upload-${file.id}@auto-mail`;editor.current?.querySelectorAll('img[data-mail-image]').forEach(image=>{if(image.getAttribute('data-mail-image')===ref)image.remove();});const url=imagePreviews.current.get(ref);if(url)URL.revokeObjectURL(url);imagePreviews.current.delete(ref);emit();}catch(reason){setError(reason instanceof Error?reason.message:'Unable to remove attachment.');}finally{props.onBusyChange(false);}};
  const buttons=[{label:'Undo',icon:Undo2,cmd:'undo'},{label:'Redo',icon:Redo2,cmd:'redo'},{label:'Bold',icon:Bold,cmd:'bold'},{label:'Italic',icon:Italic,cmd:'italic'},{label:'Underline',icon:Underline,cmd:'underline'},{label:'Strikethrough',icon:Strikethrough,cmd:'strikeThrough'},{label:'Bulleted list',icon:List,cmd:'insertUnorderedList'},{label:'Numbered list',icon:ListOrdered,cmd:'insertOrderedList'},{label:'Clear formatting',icon:RemoveFormatting,cmd:'removeFormat'}];
  const disabled=props.disabled||uploading||discarding;
  const discard=async()=>{
    if(disabled)return;setDiscarding(true);props.onBusyChange(true);setError('');
    try{
      const failed:ReplyUpload[]=[];
      for(const file of props.files){try{await knowledgeRequest('attachment-remove',{id:file.id});}catch{failed.push(file);}}
      if(failed.length){props.onFiles(failed);setError('Some draft attachments could not be removed. Try discarding again.');return;}
      props.onFiles([]);props.onDiscard?.();
    }finally{setDiscarding(false);props.onBusyChange(false);}
  };
  return <AutoMailAiPreview.Provider value={{target:aiTarget,setPending:setAiPending}}><div className="mt-3 flex min-w-0 items-start gap-2 sm:gap-3">
    {!props.mode&&<span aria-hidden="true" className="mt-3 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-sky-100 text-xs font-bold text-sky-700">{props.mailbox.slice(0,2).toUpperCase()}</span>}
    <section aria-label={props.mode==='compose'?'New message box':'Reply box'} className="min-w-0 flex-1 overflow-visible rounded-2xl border border-slate-200 bg-white shadow-sm">
    <form aria-label={props.mode==='compose'?'New message composer':'Reply composer'} onSubmit={event=>{event.preventDefault();if(!disabled&&!aiPending)props.onSend();}} onKeyDown={event=>{if(event.key==='Escape'){setSendMenu(false);setSignatureMenu(false);}}} className="min-w-0">
    <div className="flex min-w-0 items-center gap-2 px-4 pt-3">
      {props.mode==='compose'?<h4 className="text-sm font-semibold text-slate-800">New message</h4>:<><Reply className="h-4 w-4 shrink-0 text-slate-500"/><select aria-label="Reply action" disabled={disabled} value={props.responseMode||'reply'} onChange={event=>{if(event.target.value==='forward')props.onForward?.();else if(event.target.value==='reply-all'){props.onReplyAll();setShowCc(true);}else props.onReply?.();}} className="min-w-0 rounded-lg bg-transparent py-1 text-sm text-slate-600"><option value="reply">Reply</option><option value="reply-all">Reply all</option>{props.onForward&&<option value="forward">Forward</option>}</select></>}
      <p className="ml-auto truncate text-xs text-slate-400" title={props.mailbox}>From {props.mailbox}</p>
    </div>
    <div className="space-y-1.5 px-4 py-3">
      {props.richReady?<><div className="flex items-start gap-2"><label className="w-7 shrink-0 pt-1.5 text-xs text-slate-500" htmlFor={`${props.requestId}-to`}>To</label><AutoMailRecipientInput label="Reply To recipients" value={props.to} disabled={disabled} contacts={props.contacts||[]} onChange={value=>props.onRecipients('to',value)}/><AutoMailRecipients to={props.to} cc={props.cc} bcc={props.bcc} buttonOnly/><button type="button" disabled={disabled} onClick={()=>setShowCc(value=>!value)} className="pt-1.5 text-xs text-slate-500 underline">CC</button><button type="button" disabled={disabled} onClick={()=>setShowBcc(value=>!value)} className="pt-1.5 text-xs text-slate-500 underline">BCC</button></div>
        {(showCc||props.cc)&&<div className="flex items-start gap-2"><span className="w-7 shrink-0 pt-1.5 text-xs text-slate-500">CC</span><AutoMailRecipientInput label="Reply CC recipients" value={props.cc} disabled={disabled} contacts={props.contacts||[]} onChange={value=>props.onRecipients('cc',value)}/></div>}
        {(showBcc||props.bcc)&&<div className="flex items-start gap-2"><span className="w-7 shrink-0 pt-1.5 text-xs text-slate-500">BCC</span><AutoMailRecipientInput label="Reply BCC recipients" value={props.bcc} disabled={disabled} contacts={props.contacts||[]} onChange={value=>props.onRecipients('bcc',value)}/></div>}
      </>:<><p className="break-all text-sm text-slate-600">Reply to: <strong>{props.to}</strong></p><p className="text-xs text-slate-500">Formatting, CC/BCC and attachments need setup. Plain-text replies remain available.</p></>}
      {props.mode==='compose'&&<label className="flex items-center gap-3 text-xs font-medium text-slate-500">Subject<input aria-label="Message subject" value={props.subject||''} maxLength={998} disabled={disabled} onChange={event=>props.onSubject?.(event.target.value)} className="min-w-0 flex-1 border-b border-slate-100 bg-transparent px-1 py-1 text-sm font-normal"/></label>}
      <div className="min-w-0">
        {props.richReady&&<div role="toolbar" aria-label="Reply formatting" className="mb-2 flex w-full flex-nowrap items-center gap-0.5 overflow-x-auto rounded-xl bg-slate-100 p-1.5 [&>*]:shrink-0">
          <select aria-label="Reply text style" disabled={disabled} defaultValue="p" onChange={event=>{command('formatBlock',event.target.value);event.target.value='p';}} className="h-8 max-w-32 rounded-xl border border-slate-200 bg-white px-1 text-xs"><option value="p">Normal text</option><option value="h2">Heading</option><option value="h3">Subheading</option><option value="blockquote">Quote</option></select>
          <AutoMailFormatPicker label="Reply font" value={font} disabled={disabled} onRemember={rememberSelection} onChange={value=>{restoreSelection();setFont(value);command('fontName',value);}} items={[['Arial','Sans Serif'],['Georgia','Serif'],['Courier New','Fixed width'],['Arial Black','Wide'],['Arial Narrow','Narrow'],['Comic Sans MS','Comic Sans MS'],['Garamond','Garamond'],['Georgia','Georgia'],['Tahoma','Tahoma'],['Trebuchet MS','Trebuchet MS'],['Verdana','Verdana']].map(([value,label])=>({value:label==='Serif'?'serif':value,label,style:{fontFamily:value,fontSize:14}}))}/>
          <AutoMailFormatPicker label="Reply font size" value={fontSize} disabled={disabled} onRemember={rememberSelection} onChange={value=>{restoreSelection();setFontSize(value);command('fontSize',value);}} items={[{value:'2',label:'Small',style:{fontSize:12}},{value:'3',label:'Normal',style:{fontSize:14}},{value:'4',label:'Large',style:{fontSize:18}},{value:'6',label:'Huge',style:{fontSize:30}}]}/>

          <AutoMailFormatPicker label="Text alignment" value={alignment} icon={alignment==='justifyCenter'?<AlignCenter className="h-4 w-4"/>:alignment==='justifyRight'?<AlignRight className="h-4 w-4"/>:<AlignLeft className="h-4 w-4"/>} disabled={disabled} onRemember={rememberSelection} onChange={value=>{restoreSelection();setAlignment(value);command(value);}} items={[{value:'justifyLeft',label:'Align left'},{value:'justifyCenter',label:'Align center'},{value:'justifyRight',label:'Align right'}]}/>
          {buttons.map(item=><button key={item.cmd} type="button" title={item.label} aria-label={item.label} disabled={disabled} onMouseDown={event=>event.preventDefault()} onClick={()=>command(item.cmd)} className="rounded p-1.5 text-slate-500 hover:bg-slate-200 disabled:opacity-40"><item.icon className="h-4 w-4"/></button>)}
          <button type="button" title="Insert link" aria-label="Insert reply link" disabled={disabled} onMouseDown={event=>event.preventDefault()} onClick={()=>{const selection=window.getSelection();savedRange.current=selection?.rangeCount?selection.getRangeAt(0).cloneRange():null;setLinkText(selection?.toString()||'');setLinkUrl('');setLinkOpen(value=>!value);}} className="rounded p-1.5 text-slate-500 hover:bg-slate-200"><Link className="h-4 w-4"/></button>
          <label title="Text color" className="flex h-8 w-8 items-center justify-center"><input type="color" aria-label="Reply text color" defaultValue="#334155" disabled={disabled} onInput={event=>command('foreColor',event.currentTarget.value)} className="h-5 w-5 cursor-pointer border-0 bg-transparent p-0"/></label>
        </div>}
        {linkOpen&&<div onKeyDown={event=>{if(event.key==='Enter')event.preventDefault();}} className="space-y-2 border-b border-slate-200 bg-sky-50 p-3"><label className="block text-xs">Link text<input aria-label="Reply link text" value={linkText} onChange={event=>setLinkText(event.target.value)} className="mt-1 w-full rounded border border-slate-200 p-2 text-sm"/></label><label className="block text-xs">Link URL<input aria-label="Reply link URL" value={linkUrl} onChange={event=>setLinkUrl(event.target.value)} placeholder="https:// or mailto:" className="mt-1 w-full rounded border border-slate-200 p-2 text-sm"/></label><button type="button" disabled={!/^(https?:\/\/|mailto:)/i.test(linkUrl)} onClick={()=>{editor.current?.focus();if(savedRange.current&&editor.current?.contains(savedRange.current.commonAncestorContainer)){const selection=window.getSelection();selection?.removeAllRanges();selection?.addRange(savedRange.current);}command('insertHTML',`<a href="${escapeMailText(linkUrl)}">${escapeMailText(linkText||linkUrl)}</a>`);setLinkOpen(false);}} className="rounded bg-sky-600 px-3 py-1.5 text-xs text-white disabled:opacity-50">Insert link</button></div>}
        {props.richReady?<div ref={editor} contentEditable={!disabled} suppressContentEditableWarning role="textbox" aria-label="Your reply" aria-multiline="true" aria-disabled={disabled} onInput={emit} onPaste={paste} className={`auto-mail-content ${aiPending&&!props.body?'min-h-0':'min-h-56'} px-4 py-3 text-sm outline-none`} data-placeholder="Write your reply..."/>:<textarea aria-label="Your reply" value={props.body} onChange={event=>props.onChange(event.target.value,'')} disabled={disabled} maxLength={50000} rows={7} className="block w-full resize-y p-3 text-sm outline-none" placeholder="Write your reply..."/>}
        <div ref={setAiTarget} aria-label="AI suggestion preview"/>
      </div>
      {!!props.files.length&&<ul aria-label="Reply attachments" className="space-y-2">{props.files.map(file=><li key={file.id} className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 p-2"><Paperclip className="h-4 w-4 shrink-0 text-sky-600"/><span className="min-w-0 flex-1 break-all text-xs">{file.name} <span className="text-slate-400">({fileSize(file.size)})</span></span><button type="button" aria-label={`Remove ${file.name}`} disabled={disabled} onClick={()=>void remove(file)} className="p-1 text-slate-400 hover:text-red-600"><X className="h-4 w-4"/></button></li>)}</ul>}
      {error&&<AutoMailSnackbarArea><AutoMailSnackbar key={error} alert onDismiss={()=>setError('')}>{error}</AutoMailSnackbar></AutoMailSnackbarArea>}
      <div className="flex items-end gap-2"><div className="flex min-w-0 flex-1 flex-wrap items-center gap-3"><div ref={sendMenuRef} className="relative inline-flex"><button type="submit" onMouseDown={event=>event.preventDefault()} disabled={disabled||aiPending||(!props.body.trim()&&!props.files.length)} className="inline-flex items-center gap-2 rounded-l-full bg-sky-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-sky-700 disabled:opacity-50"><Send className="h-4 w-4"/>{props.sending?'Sending...':props.mode==='compose'?'Send message':'Send reply'}</button><button type="button" onMouseDown={event=>event.preventDefault()} aria-label="Send options" aria-haspopup="menu" aria-expanded={sendMenu} disabled={disabled||aiPending} onClick={()=>{setSignatureMenu(false);setSendMenu(current=>!current);}} className="rounded-r-full border-l border-white/30 bg-sky-600 px-2 text-white hover:bg-sky-700 disabled:opacity-50"><MoreVertical className="h-4 w-4"/></button>
        {sendMenu&&<div role="menu" aria-label="Send options" className="absolute bottom-full left-0 z-30 mb-2 w-52 rounded-xl border border-slate-200 bg-white p-1 shadow-xl"><button type="button" role="menuitem" onMouseDown={event=>event.preventDefault()} disabled={disabled||aiPending||!props.schedulerReady||!props.onSchedule||(!props.body.trim()&&!props.files.length)} onClick={()=>{setSendMenu(false);setScheduleError('');scheduleDialog.current?.showModal();}} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"><Clock className="h-4 w-4"/>Schedule send</button>{!props.schedulerReady&&<p className="px-3 py-2 text-xs text-slate-400">Scheduled sending is currently unavailable.</p>}</div>}
      </div>{props.richReady&&<><input ref={picker} aria-label="Attach reply files" type="file" multiple accept=".pdf,.png,.jpg,.jpeg,.gif,.webp,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.csv,.txt,.zip" onChange={event=>void upload(event.target.files)} className="hidden"/><button type="button" disabled={disabled} onMouseDown={event=>event.preventDefault()} onClick={()=>picker.current?.click()} className="inline-flex items-center gap-1 rounded-xl border border-slate-200 px-3 py-2.5 text-xs text-slate-600"><Paperclip className="h-4 w-4"/>{uploading?'Uploading...':'Attach files'}</button></>}{props.richReady&&<div ref={signatureMenuRef} className="relative"><button type="button" onMouseDown={event=>event.preventDefault()} aria-label="Insert signature" aria-haspopup="menu" aria-expanded={signatureMenu} disabled={disabled} onClick={()=>{setSendMenu(false);setSignatureMenu(current=>!current);}} className="rounded-xl border border-slate-200 p-2.5 text-slate-500 hover:bg-slate-50"><PenLine className="h-4 w-4"/></button>{signatureMenu&&<div role="menu" aria-label="Signatures" className="absolute bottom-full left-0 z-30 mb-2 w-52 rounded-xl border border-slate-200 bg-white p-1 shadow-xl"><button type="button" role="menuitem" onMouseDown={event=>event.preventDefault()} onClick={()=>{setSignatureMenu(false);props.onManageSignatures?.();}} className="w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-slate-50">Manage signatures</button><div className="my-1 border-t border-slate-100"/><button type="button" role="menuitem" onMouseDown={event=>event.preventDefault()} onClick={()=>insertSignature('')} className="w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-slate-50">No signature</button>{signatures.map(item=><button type="button" role="menuitem" key={item.id} onMouseDown={event=>event.preventDefault()} onClick={()=>insertSignature(item.html)} className="w-full truncate rounded-lg px-3 py-2 text-left text-sm hover:bg-slate-50">{item.name}</button>)}</div>}</div>}{props.extraActions}{props.helpers&&<div aria-label="Reply helper tools" className="flex flex-wrap gap-2">
        {props.helpers.ai&&<button type="button" aria-expanded={helper==='ai'} onClick={()=>setHelper(current=>current==='ai'?null:'ai')} className="rounded-full px-3 py-2 text-xs font-medium text-violet-700 hover:bg-violet-50">AI reply suggestion</button>}
        {props.helpers.knowledge&&<button type="button" aria-expanded={helper==='knowledge'} onClick={()=>setHelper(current=>current==='knowledge'?null:'knowledge')} className="rounded-full px-3 py-2 text-xs font-medium text-sky-700 hover:bg-sky-50">Find an approved answer</button>}
      </div>}</div>{props.onDiscard&&<button type="button" aria-label="Discard draft" title="Discard draft" disabled={disabled} onClick={()=>void discard()} className="shrink-0 rounded-full p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-800 disabled:opacity-40"><Trash2 className="h-4 w-4"/></button>}</div>
    </div>

  </form>
    <dialog ref={scheduleDialog} aria-label="Schedule send" className="fixed inset-0 m-auto w-[min(92vw,420px)] rounded-2xl border border-slate-200 bg-white p-5 shadow-xl backdrop:bg-slate-950/30"><h3 className="mb-4 font-semibold">Schedule send</h3><label className="block text-sm text-slate-600">Date and time<input type="datetime-local" aria-label="Scheduled send time" value={scheduleAt} onChange={event=>setScheduleAt(event.target.value)} className="mt-2 block w-full rounded-xl border border-slate-200 px-3 py-2"/></label><p className="mt-2 text-xs text-slate-400">{Intl.DateTimeFormat().resolvedOptions().timeZone}</p>{scheduleError&&<p role="alert" className="mt-2 text-sm text-red-700">{scheduleError}</p>}<div className="mt-4 flex gap-2"><button type="button" disabled={disabled||aiPending} onClick={()=>{if(aiPending)return;const when=new Date(scheduleAt);if(!scheduleAt||!Number.isFinite(when.getTime())||when.getTime()<Date.now()+120000||when.getTime()>Date.now()+90*86400000){setScheduleError('Choose a time between 2 minutes and 90 days from now.');return;}props.onSchedule?.(when.toISOString());scheduleDialog.current?.close();}} className="rounded-full bg-sky-600 px-4 py-2 text-sm text-white">Schedule send</button><button type="button" onClick={()=>scheduleDialog.current?.close()} className="rounded-full border border-slate-200 px-4 py-2 text-sm">Cancel</button></div></dialog>
    {props.helpers&&<div role="group" aria-label="Reply helpers" className={helper?"border-t border-slate-100 px-4 pb-2":""}><div hidden={helper!=='ai'}>{props.helpers.ai}</div><div hidden={helper!=='knowledge'}>{props.helpers.knowledge}</div></div>}
    </section>
  </div></AutoMailAiPreview.Provider>;
}
