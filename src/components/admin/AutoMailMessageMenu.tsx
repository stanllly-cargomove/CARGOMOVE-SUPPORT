import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { FileText, Forward, Mail, MoreVertical, Reply, ReplyAll, Trash2 } from 'lucide-react';

const menuPosition=(button:HTMLButtonElement)=>{const rect=button.getBoundingClientRect();return {left:Math.max(8,Math.min(rect.right-216,window.innerWidth-224)),top:Math.max(8,Math.min(rect.bottom+4,window.innerHeight-280))};};
export type MessageAction = 'reply' | 'reply-all' | 'forward' | 'trash' | 'unread';
export function AutoMailMessageMenu({ onAction, onTogglePlain, plain = false, disabled = false, replyBlocked = '', forwardBlocked = false }: {
  onTogglePlain?: () => void; plain?: boolean;
  onAction: (action: MessageAction) => void; disabled?: boolean; replyBlocked?: string; forwardBlocked?: boolean;
}) {
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const button = useRef<HTMLButtonElement>(null), menu = useRef<HTMLDivElement>(null);
  const open=position!==null;
  useEffect(() => {
    if (!open) return;
    menu.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus({preventScroll:true});
    const close = () => setPosition(null);
    const reposition = () => {if(button.current)setPosition(menuPosition(button.current));};
    const outside = (event: PointerEvent) => { if (!menu.current?.contains(event.target as Node) && !button.current?.contains(event.target as Node)) close(); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); close(); button.current?.focus({preventScroll:true}); } };
    document.addEventListener('pointerdown', outside); document.addEventListener('keydown', escape);
    window.addEventListener('resize', reposition); window.addEventListener('scroll', reposition, true);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); window.removeEventListener('resize', reposition); window.removeEventListener('scroll', reposition, true); };
  }, [open]);
  const options = [
    { action: 'reply', label: 'Reply', icon: Reply },
    { action: 'reply-all', label: 'Reply all', icon: ReplyAll },
    { action: 'forward', label: 'Forward', icon: Forward },
    { action: 'trash', label: 'Delete', icon: Trash2 },
    { action: 'unread', label: 'Mark as unread', icon: Mail },
    ...(onTogglePlain ? [{ action: 'plain' as const, label: plain ? 'Formatted view' : 'Plain text view', icon: FileText }] : []),
  ] as const;
  return <><button ref={button} type="button" aria-label="Message options" aria-haspopup="menu" aria-expanded={!!position} disabled={disabled} className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-slate-500 hover:bg-slate-200/60 disabled:opacity-50" onClick={event => {
    event.preventDefault();event.stopPropagation();
    setPosition(position ? null : menuPosition(button.current!));
  }}><MoreVertical className="h-4 w-4" /></button>
  {position && createPortal(<div ref={menu} role="menu" aria-label="Message actions" style={position} className="fixed z-[110] w-[216px] rounded-lg border border-slate-200 bg-white py-1 shadow-xl" onKeyDown={event => {
    const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === 'ArrowDown' ? (index + 1) % items.length : event.key === 'ArrowUp' ? (index - 1 + items.length) % items.length : event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : null;
    if (next !== null) { event.preventDefault(); items[next]?.focus(); }
    if (event.key === 'Tab') setPosition(null);
  }}>{options.map(({ action, label, icon: Icon }) => <button key={action} type="button" role="menuitem" disabled={disabled || ((action === 'reply' || action === 'reply-all') && !!replyBlocked) || (action === 'forward' && forwardBlocked)} title={(action === 'reply' || action === 'reply-all') ? replyBlocked : action === 'trash' ? 'Move this conversation to Gmail Trash' : undefined} onClick={event => { event.preventDefault();event.stopPropagation();setPosition(null); button.current?.focus({preventScroll:true}); if(action==='plain')onTogglePlain?.();else onAction(action); }} className={`flex w-full items-center gap-3 px-4 py-2 text-left text-sm text-slate-700 hover:bg-slate-100 focus:bg-slate-100 focus:outline-none disabled:opacity-40 ${action === 'trash' ? 'mt-1 border-t border-slate-200 pt-3' : ''}`}>
    <span className="relative"><Icon className="h-4 w-4" />{action === 'unread' && <span className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-slate-600 ring-2 ring-white" />}</span>{label}
  </button>)}</div>, document.body)}</>;
}
