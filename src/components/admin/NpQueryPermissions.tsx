import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { ShieldCheck, X } from 'lucide-react';
import type { NpMovement } from '../../../shared/np-query';
import { NpPermissionsContent } from './NpQueryRecord';

export function NpQueryPermissions({ record }: { record: NpMovement }) {
  return <QueryHoldsPopover><NpPermissionsContent record={record} /></QueryHoldsPopover>;
}

/** Anchored to the details actions so the panel stays inside the mobile viewport. */
export function QueryHoldsPopover({ children, label = 'Holds & Permissions' }: { children: ReactNode; label?: string }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const id = useId();
  const cancelClose = () => { if (timer.current) clearTimeout(timer.current); };
  const show = () => { cancelClose(); setOpen(true); };
  const hide = () => { cancelClose(); setOpen(false); };
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);
  return <div ref={root} onMouseEnter={show} onMouseLeave={() => {
    cancelClose();
    timer.current = setTimeout(() => {
      if (!root.current?.contains(document.activeElement)) setOpen(false);
    }, 150);
  }} onFocus={show} onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget)) hide();
  }} onKeyDown={event => {
    if (event.key === 'Escape' && open) {
      event.stopPropagation(); button.current?.focus(); hide();
    }
  }}>
    <button ref={button} type="button" aria-label={label} aria-expanded={open} aria-controls={id} onClick={show} className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 text-blue-600 hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
      <ShieldCheck aria-hidden="true" className="h-4 w-4" />
    </button>
    <div id={id} hidden={!open} role="region" aria-label={label} className="np-permissions-popup absolute right-0 top-full z-30 pt-2">
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
        <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-3 py-2">
          <h4 className="text-xs font-semibold text-slate-900">{label}</h4>
          <button type="button" aria-label={`Close ${label.toLowerCase().replace('&', 'and')}`} onClick={() => { button.current?.focus(); hide(); }} className="inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-blue-500"><X aria-hidden="true" className="h-4 w-4" /></button>
        </div>
        <div className="max-h-72 overflow-y-auto">{children}</div>
      </div>
    </div>
  </div>;
}
