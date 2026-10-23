import React,{useEffect,useId,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {ChevronDown} from 'lucide-react';
export function AutoMailFormatPicker({label,value,items,onChange,disabled,onRemember,icon}:{label:string;value:string;items:{value:string;label:string;style?:React.CSSProperties}[];onChange:(value:string)=>void;disabled:boolean;onRemember:()=>void;icon?:React.ReactNode}){
  const[open,setOpen]=useState(false);const[position,setPosition]=useState({left:0,top:0});const root=useRef<HTMLDivElement>(null);const popup=useRef<HTMLDivElement>(null);const id=useId();
  useEffect(()=>{
    if(!open)return;
    const reposition=()=>{const rect=root.current?.getBoundingClientRect();if(!rect)return;const height=Math.min(288,items.length*48+8);setPosition({left:Math.max(8,Math.min(rect.left,innerWidth-192)),top:Math.max(8,rect.bottom+height>innerHeight&&rect.top>height?rect.top-height-4:Math.min(rect.bottom+4,innerHeight-height-8))});};
    reposition();
    const close=(event:PointerEvent)=>{if(!root.current?.contains(event.target as Node)&&!popup.current?.contains(event.target as Node))setOpen(false);};
    document.addEventListener('pointerdown',close);window.addEventListener('resize',reposition);window.addEventListener('scroll',reposition,true);
    return()=>{document.removeEventListener('pointerdown',close);window.removeEventListener('resize',reposition);window.removeEventListener('scroll',reposition,true);};
  },[open,items.length]);
  return <div ref={root} className="relative shrink-0"><button type="button" aria-label={label} title={label} aria-haspopup="listbox" aria-expanded={open} aria-controls={id} disabled={disabled} onMouseDown={event=>{event.preventDefault();onRemember();}} onClick={()=>setOpen(current=>!current)} onKeyDown={event=>{if(event.key==='Escape')setOpen(false);if(event.key==='ArrowDown'){event.preventDefault();setOpen(true);window.setTimeout(()=>popup.current?.querySelector<HTMLButtonElement>('[role="option"]')?.focus({preventScroll:true}),0);}}} className="flex h-8 items-center gap-1 rounded-xl border border-slate-200 bg-white px-2 text-xs text-slate-700">{icon||items.find(item=>item.value===value)?.label}<ChevronDown className="h-3 w-3"/></button>
    {open&&createPortal(<div ref={popup} id={id} role="listbox" aria-label={label} style={position} onKeyDown={event=>{const options=Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="option"]'));const index=options.indexOf(document.activeElement as HTMLButtonElement);if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();options[(index+(event.key==='ArrowDown'?1:-1)+options.length)%options.length]?.focus();}if(event.key==='Escape'){setOpen(false);root.current?.querySelector('button')?.focus({preventScroll:true});}}} className="fixed z-[110] max-h-72 min-w-40 max-w-[calc(100vw-16px)] overflow-y-auto rounded-xl border border-slate-200 bg-white p-1 shadow-xl">{items.map(item=><button key={item.value} type="button" role="option" aria-selected={value===item.value} style={item.style} onMouseDown={event=>event.preventDefault()} onClick={()=>{onChange(item.value);setOpen(false);}} className="block w-full whitespace-nowrap rounded-lg px-3 py-2 text-left text-sm hover:bg-sky-50">{item.label}</button>)}</div>,document.body)}
  </div>;
}
