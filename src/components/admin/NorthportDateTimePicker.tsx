import React, { useEffect, useLayoutEffect, useId, useRef, useState } from 'react';
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight, ChevronUp } from 'lucide-react';

const control = 'flex min-h-11 w-full min-w-0 items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-60';
const action = 'rounded-lg p-2 text-slate-600 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500';
const pad = (value: number) => String(value).padStart(2, '0');
const dateKey = (date: Date) => `${date.getUTCFullYear()}-${pad(date.getUTCMonth()+1)}-${pad(date.getUTCDate())}`;
const malaysiaToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuala_Lumpur', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const malaysiaNow = () => {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kuala_Lumpur', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date());
  const part = (type: string) => parts.find(item => item.type===type)!.value;
  return `${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}`;
};

function PickerPopover({ label, disabled, display, children, onOpen, wide = false, showChevron = true }: {
  label: string; disabled: boolean; display: React.ReactNode;
  children: (close: () => void) => React.ReactNode; onOpen?: () => void; wide?: boolean; showChevron?: boolean;
}) {
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => { if (disabled) panel.current?.hidePopover(); }, [disabled]);
  useEffect(() => {
    const onScroll = (event: Event) => {
      // Install before opening so an immediate page scroll also dismisses it.
      if (event.target instanceof Node && panel.current?.contains(event.target)) return;
      if (panel.current?.matches(':popover-open')) panel.current.hidePopover();
    };
    window.addEventListener('scroll', onScroll, true);
    return () => window.removeEventListener('scroll', onScroll, true);
  }, []);
  useLayoutEffect(() => {
    if (!open) return;
    const position = () => {
      const rect = trigger.current?.getBoundingClientRect(); const menu = panel.current;
      if (!rect || !menu) return;
      if (rect.bottom < 48 || rect.top >= window.innerHeight) { menu.hidePopover(); return; }
      menu.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth-menu.offsetWidth-8))}px`;
      const below = window.innerHeight - rect.bottom - 8;
      const top = below >= menu.offsetHeight || rect.top < menu.offsetHeight + 8 ? rect.bottom + 6 : rect.top - menu.offsetHeight - 6;
      menu.style.top = `${Math.max(8, Math.min(top, window.innerHeight-menu.offsetHeight-8))}px`;
    };
    position(); window.addEventListener('resize', position);
    return () => window.removeEventListener('resize', position);
  }, [open]);
  const close = () => { panel.current?.hidePopover(); trigger.current?.focus(); };
  return <>
    <button ref={trigger} type="button" aria-label={label} aria-haspopup="dialog" aria-expanded={open} disabled={disabled} className={control} onClick={() => {
      if (panel.current?.matches(':popover-open')) { close(); return; }
      onOpen?.(); panel.current?.showPopover();
    }}>{display}{showChevron && <ChevronDown aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-slate-400"/>}</button>
    <div ref={panel} popover="auto" role="dialog" aria-label={`${label} picker`} onToggle={() => setOpen(panel.current?.matches(':popover-open') ?? false)} style={{ position: 'fixed', margin: 0 }} className={'max-h-[calc(100dvh-1rem)] max-w-[calc(100vw-1rem)] overflow-y-auto rounded-xl border border-slate-200 bg-white p-3 text-xs text-slate-700 shadow-xl '+(wide?'w-[520px]':'w-52')}>
      {children(close)}
    </div>
  </>;
}

const rowHeight = 36;
function ScrollColumn({ label, value, min = 0, max, step = 1, loop = true, onChange }: { label: string; value: number; min?: number; max: number; step?: number; loop?: boolean; onChange: (value: number) => void }) {
  const list = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const scrolling = useRef(false);
  const ready = useRef(false);
  const currentValue = useRef(value);
  currentValue.current = value;
  const id = useId();
  const count = Math.floor((max-min)/step)+1;
  const offset = loop ? count : 0;
  const wrap = (index: number) => loop ? ((index%count)+count)%count : Math.max(0,Math.min(count-1,index));
  const choose = (next: number) => {
    clearTimeout(timer.current); scrolling.current=false;
    const wrapped=min+wrap(Math.round((next-min)/step))*step;
    currentValue.current=wrapped;
    if(list.current)list.current.scrollTop=(offset+(wrapped-min)/step)*rowHeight;
    onChange(wrapped);
  };
  useEffect(() => {
    const element = list.current;
    if (!element) return;
    const align = () => {
      ready.current=false;
      if (!element.clientHeight) return;
      element.querySelectorAll<HTMLElement>('[data-wheel-spacer]').forEach(spacer => { spacer.style.height=`${Math.max(0,(element.clientHeight-rowHeight)/2)}px`; });
      element.scrollTop = (offset+(currentValue.current-min)/step)*rowHeight;
      requestAnimationFrame(() => { ready.current=true; });
    };
    const observer = new ResizeObserver(align); observer.observe(element);
    return () => { observer.disconnect(); clearTimeout(timer.current); };
  }, [step, offset, min]);
  useEffect(() => { if (list.current && !scrolling.current) list.current.scrollTop=(offset+(value-min)/step)*rowHeight; }, [value, step, offset, min]);
  return <div className="flex h-full min-h-0 min-w-0 flex-col items-stretch" data-scroll-column={label}>
    <p className="mb-1 text-center text-[10px] font-medium text-slate-500">{label}</p>
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
      <button type="button" aria-label={`Decrease ${label}`} disabled={!loop&&value===min} className={action+' flex h-8 shrink-0 items-center justify-center p-1 disabled:opacity-30'} onClick={() => choose(value-step)}><ChevronUp aria-hidden="true" className="h-3.5 w-3.5"/></button>
      <div className="relative min-h-0 flex-1">
        <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-1/2 h-9 -translate-y-1/2 border-y border-blue-200 bg-blue-100"/>
        <div ref={list} role="listbox" aria-label={label} aria-activedescendant={`${id}-${value}`} tabIndex={0} className="relative h-full snap-y snap-mandatory overflow-y-auto overscroll-contain text-center outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" onKeyDown={event => {
          const next=event.key==='ArrowUp'?value-step:event.key==='ArrowDown'?value+step:event.key==='Home'?min:event.key==='End'?max:null;
          if(next===null)return;event.preventDefault();choose(next);
        }} onScroll={event => {
          if(!ready.current)return;
          const element=event.currentTarget; clearTimeout(timer.current); scrolling.current=true;
          const index=Math.round(element.scrollTop/rowHeight);
          const next=min+wrap(index)*step;
          // Keep the wheel in the middle copy so scrolling can continue in either direction.
          if(loop&&index<count)element.scrollTop+=count*rowHeight;
          else if(loop&&index>=2*count)element.scrollTop-=count*rowHeight;
          if(next!==currentValue.current){currentValue.current=next;onChange(next);}
          // Let native snapping settle instead of forcing scrollTop back while
          // the browser is still handling the wheel gesture.
          timer.current=setTimeout(() => { scrolling.current=false; },160);
        }}>
          <div data-wheel-spacer aria-hidden="true"/>
          {Array.from({length:count*(loop?3:1)}, (_, index) => {
            const number=min+(index%count)*step; const primary=!loop||(index>=count&&index<2*count);
            return <button key={index} id={primary?`${id}-${number}`:undefined} type="button" role={primary?'option':undefined} aria-hidden={primary?undefined:true} aria-label={primary?`${label} ${pad(number)}`:undefined} aria-selected={primary?number===value:undefined} tabIndex={-1} className={'block h-9 w-full shrink-0 snap-center text-xs tabular-nums outline-none '+(number===value?'font-bold text-blue-700':'text-slate-500 hover:text-blue-600')} onClick={() => choose(number)}>{pad(number)}</button>;
          })}
          <div data-wheel-spacer aria-hidden="true"/>
        </div>
      </div>
      <button type="button" aria-label={`Increase ${label}`} disabled={!loop&&value===max} className={action+' flex h-8 shrink-0 items-center justify-center p-1 disabled:opacity-30'} onClick={() => choose(value+step)}><ChevronDown aria-hidden="true" className="h-3.5 w-3.5"/></button>
    </div>
  </div>;
}

export function NorthportDateTimePicker({ value, disabled, onChange }: { value: string; disabled: boolean; onChange: (value: string) => void }) {
  const [draft, setDraft] = useState('');
  const draftRef = useRef('');
  const [month, setMonth] = useState('');
  const selectDateTime = (next: string) => {
    draftRef.current=next;
    setDraft(next);
    onChange(next+':00');
  };
  const selected = draft.slice(0,10);
  const viewed = new Date(`${month || malaysiaToday().slice(0,7)}-01T00:00:00Z`);
  const year = viewed.getUTCFullYear(); const monthIndex = viewed.getUTCMonth();
  const days = new Date(Date.UTC(year, monthIndex+1, 0)).getUTCDate();
  const shiftMonth = (offset: number) => setMonth(dateKey(new Date(Date.UTC(year, monthIndex+offset, 1))).slice(0,7));
  return <PickerPopover wide label="EIR time (Malaysia)" disabled={disabled} onOpen={() => {
    const initial = value ? value.slice(0,16) : malaysiaNow();
    draftRef.current=initial;
    setDraft(initial); setMonth(initial.slice(0,7));
  }} display={<span className="flex min-w-0 items-center gap-2"><CalendarDays aria-hidden="true" className="hidden h-4 w-4 shrink-0 text-slate-400 sm:block"/><span className={'flex flex-col gap-x-1.5 text-left leading-4 sm:flex-row sm:flex-wrap '+(!value?'font-normal text-slate-400':'')}>
    {value ? <><span className="whitespace-nowrap">{value.slice(0,10).split('-').reverse().join('/')}</span><span className="whitespace-nowrap text-slate-500">{value.slice(11,16)}</span></> : <><span className="northport-eir-compact-label sm:hidden">Date/Time</span><span className="northport-eir-full-label hidden sm:inline">Select date &amp; time</span></>}
  </span></span>}>
    {close => <>
      <div className="flex h-[260px] gap-2 sm:gap-4">
        <div className="flex min-w-0 flex-1 flex-col" data-calendar>
          <div className="mb-1 flex h-8 shrink-0 items-center justify-between gap-1"><button type="button" aria-label="Previous month" className={action+' p-1'} onClick={() => shiftMonth(-1)}><ChevronLeft aria-hidden="true" className="h-3.5 w-3.5"/></button><span aria-live="polite" className="text-center text-[10px] font-semibold text-slate-900 sm:text-xs">{viewed.toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })}</span><button type="button" aria-label="Next month" className={action+' p-1'} onClick={() => shiftMonth(1)}><ChevronRight aria-hidden="true" className="h-3.5 w-3.5"/></button></div>
          <div className="grid h-7 shrink-0 grid-cols-7 items-center text-center text-[9px] font-medium text-slate-400 sm:text-[10px]">{['Su','Mo','Tu','We','Th','Fr','Sa'].map(day => <span key={day}>{day}</span>)}</div>
          <div className="grid min-h-0 flex-1 grid-cols-7 grid-rows-6 gap-0.5 text-center">
            {Array.from({length:42}, (_, index) => {
              const day=index-viewed.getUTCDay()+1;
              if(day<1||day>days)return <span key={index}/>;
              const date=month+'-'+pad(day);
              return <button type="button" key={index} aria-label={date} aria-pressed={date===selected} className={'min-w-0 rounded-lg text-[10px] outline-none focus-visible:ring-2 focus-visible:ring-blue-500 sm:text-xs '+(date===selected?'bg-blue-600 font-semibold text-white':'hover:bg-blue-50')} onClick={() => selectDateTime(date+draftRef.current.slice(10))}>{day}</button>;
            })}
          </div>
        </div>
        <div className="grid h-full w-[96px] shrink-0 grid-cols-2 gap-1.5 border-l border-slate-100 pl-2 sm:w-[128px] sm:gap-2 sm:pl-4" aria-label="24-hour time (Malaysia)">
          <ScrollColumn label="Hour" value={Number(draft.slice(11,13))} max={23} onChange={hour=>selectDateTime(draftRef.current.slice(0,11)+pad(hour)+draftRef.current.slice(13))}/>
          <ScrollColumn label="Minute" value={Number(draft.slice(14,16))} max={59} onChange={minute=>selectDateTime(draftRef.current.slice(0,14)+pad(minute))}/>
        </div>
      </div>
      <div className="mt-4 flex items-center justify-between gap-2"><button type="button" className={action} onClick={() => {const today=malaysiaToday();setMonth(today.slice(0,7));selectDateTime(today+draftRef.current.slice(10));}}>Today</button><button type="button" className="rounded-lg bg-blue-600 px-4 py-2.5 font-semibold text-white hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2" onClick={() => {onChange(draftRef.current+':00');close();}}>Done</button></div>
    </>}
  </PickerPopover>;
}

export function NorthportTimeRangePicker({ direction, value, disabled, onChange }: { direction: 'before'|'after'; value: number; disabled: boolean; onChange: (value: number) => void }) {
  const positionLabel = direction === 'before' ? 'Start time range' : 'End time range';
  return <PickerPopover label={positionLabel} disabled={disabled} showChevron={false} display={<span className="flex min-w-0 flex-1 items-center justify-between gap-1"><span className="font-semibold tabular-nums">{value}</span><span className="text-[11px] text-slate-500">min</span></span>}>
    {close => <>
      <div className="flex h-[260px] flex-col">
        <div className="mx-auto min-h-0 w-24 flex-1"><ScrollColumn label={direction === 'before' ? 'Minutes before' : 'Minutes after'} value={value} min={0} max={60} step={5} loop={false} onChange={onChange}/></div>
      </div>
      <button type="button" className="mt-4 w-full rounded-lg bg-blue-600 py-2.5 font-semibold text-white hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500" onClick={close}>Done</button>
    </>}
  </PickerPopover>;
}
