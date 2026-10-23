import { unzipSync } from 'fflate';
export type MailFileKind='pdf'|'image'|'excel'|'word'|'powerpoint'|'text'|'archive'|'file';
export function mailFileKind(name:string,type=''):MailFileKind{
 if(type==='application/pdf')return 'pdf';if(/^image\/(png|jpeg|gif|webp)$/.test(type))return 'image';
 if(/spreadsheet|ms-excel|text\/csv/.test(type))return 'excel';if(/wordprocessing|msword/.test(type))return 'word';
 if(/presentation|powerpoint/.test(type))return 'powerpoint';
 const extension=name.split('.').at(-1)?.toLowerCase();
 if(extension==='pdf')return 'pdf';if(['png','jpg','jpeg','gif','webp'].includes(extension||''))return 'image';
 if(['xlsx','xls','csv'].includes(extension||''))return 'excel';if(['doc','docx'].includes(extension||''))return 'word';
 if(['ppt','pptx'].includes(extension||''))return 'powerpoint';if(['txt','log'].includes(extension||''))return 'text';
 return ['zip','rar','7z'].includes(extension||'')?'archive':'file';
}
export function officeEntries(bytes:Uint8Array,select:(name:string)=>boolean){
 let size=0,count=0;
 return unzipSync(bytes,{filter:file=>{size+=file.originalSize;count++;if(size>64*1024*1024||file.originalSize>16*1024*1024||count>2000)throw new Error('Document is too complex to preview. Download it to open locally.');return select(file.name);}});
}
const starts=(bytes:Uint8Array,signature:number[])=>signature.every((value,index)=>bytes[index]===value);
export function verifiedMailFileType(bytes:Uint8Array,name:string){
 const head=new TextDecoder().decode(bytes.subarray(0,12));
 if(head.startsWith('%PDF-'))return 'application/pdf';if(starts(bytes,[137,80,78,71,13,10,26,10]))return 'image/png';
 if(starts(bytes,[255,216,255]))return 'image/jpeg';if(/^GIF8[79]a/.test(head))return 'image/gif';if(head.startsWith('RIFF')&&head.slice(8)==='WEBP')return 'image/webp';
 const extension=name.split('.').at(-1)?.toLowerCase();
 if(starts(bytes,[80,75,3,4])&&['docx','xlsx','pptx'].includes(extension||'')){
  try{const entries=officeEntries(bytes,path=>['[Content_Types].xml','word/document.xml','xl/workbook.xml','ppt/presentation.xml'].includes(path));
   if(!entries['[Content_Types].xml'])return 'application/octet-stream';
   if(extension==='docx'&&entries['word/document.xml'])return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
   if(extension==='xlsx'&&entries['xl/workbook.xml'])return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
   if(extension==='pptx'&&entries['ppt/presentation.xml'])return 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
  }catch{return 'application/octet-stream';}
 }
 if(starts(bytes,[208,207,17,224,161,177,26,225])&&extension==='xls')return 'application/vnd.ms-excel';
 if(['csv','txt','log'].includes(extension||'')&&bytes.length<=2*1024*1024&&!bytes.includes(0)&&!/[\x00-\x08\x0e-\x1f]/.test(new TextDecoder().decode(bytes)))return extension==='csv'?'text/csv':'text/plain';
 return 'application/octet-stream';
}
