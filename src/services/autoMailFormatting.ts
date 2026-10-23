import DOMPurify from 'dompurify';

export const escapeMailText = (value: string) => value.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
export const plainMailHtml = (value: string) => `<p>${escapeMailText(value).replaceAll('\n','<br>')}</p>`;
export function browserMailHtml(value: string, collapseQuotes = false) {
  const html = DOMPurify.sanitize(value, { ALLOWED_TAGS: ['p','div','span','br','b','strong','i','em','u','s','strike','ul','ol','li','blockquote','h1','h2','h3','h4','hr','pre','code','a','table','thead','tbody','tfoot','tr','td','th','caption','sub','sup','font','img'], ALLOWED_ATTR: ['href','colspan','rowspan','style','color','size','face','data-mail-signature','src','alt','width','height','data-mail-image'], ALLOW_DATA_ATTR: false });
  const template=document.createElement('template');template.innerHTML=html;
  template.content.querySelectorAll('img').forEach(image=>{const ref=image.getAttribute('data-mail-image')||image.getAttribute('src')||'';image.removeAttribute('src');if(!ref||ref.length>2048||/^(?:data|javascript|blob|file):/i.test(ref)||ref.startsWith('//')){image.remove();return;}image.setAttribute('data-mail-image',ref);for(const name of ['width','height']){const value=image.getAttribute(name);if(value&&!/^\d{1,4}$/.test(value))image.removeAttribute(name);}});
  template.content.querySelectorAll('a').forEach(link=>{if(!/^(https?:\/\/|mailto:|tel:)/i.test(link.getAttribute('href')||''))link.removeAttribute('href');link.target='_blank';link.rel='noopener noreferrer nofollow';});
  template.content.querySelectorAll<HTMLElement>('[style]').forEach(element=>{
    const style=element.style;const safe:Record<string,string>={};
    for(const name of ['color','background-color','text-align','font-size','font-family','margin-top','margin-bottom']){
      const value=style.getPropertyValue(name);
      const valid=name.startsWith('margin-')?/^(?:0(?:cm|in)?|(?:[0-9]|[1-4][0-9])(?:\.\d{1,2})?(?:px|pt)|(?:[0-3](?:\.\d{1,2})?|\.\d{1,2})(?:em|rem))$/.test(value):name==='color'||name==='background-color'?/^(#[0-9a-f]{3,8}|[a-z]{1,20}|rgba?\([0-9.,% ]+\))$/i.test(value):name==='text-align'?/^(left|right|center|justify)$/.test(value):name==='font-size'?/^(?:[1-9]|[1-6][0-9])px$|^(small|medium|large|x-large|xx-large)$/.test(value):/^[a-zA-Z ,"'-]{1,80}$/.test(value);
      if(value&&valid)safe[name]=value;
    }
    element.removeAttribute('style');Object.entries(safe).forEach(([name,value])=>style.setProperty(name,value));
  });
  if(collapseQuotes)template.content.querySelectorAll('blockquote').forEach(quote=>{
    const otherText=(template.content.textContent||'').replace(quote.textContent||'','').trim();
    if(otherText.length<30||quote.parentElement?.closest('blockquote'))return;
    const details=document.createElement('details');const summary=document.createElement('summary');summary.textContent='Show quoted history';details.append(summary);quote.replaceWith(details);details.append(quote);
  });
  return template.innerHTML;
}
export function browserMailText(html: string) {
  const element=document.createElement('div');element.innerHTML=browserMailHtml(html);
  element.querySelectorAll('br').forEach(br=>br.replaceWith('\n'));
  element.querySelectorAll('p,div,li,h1,h2,h3,blockquote').forEach(block=>block.append('\n'));
  return (element.textContent||'').replace(/\n{3,}/g,'\n\n').trim();
}
export function fileSize(size: number) { return size>=1048576?`${(size/1048576).toFixed(1)} MB`:`${Math.max(1,Math.ceil(size/1024))} KB`; }
