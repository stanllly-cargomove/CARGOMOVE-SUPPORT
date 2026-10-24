import React, { useEffect, useState } from 'react';
import * as storage from '../../services/storage';

const defaults = ['PORT KLANG', 'NORTHPORT', 'WESTPORT', 'JOHOR'];
const portOptions = () => [...new Set([...defaults, ...(storage.getPorts?.() || []).filter(port => port.active).map(port => port.display_name.trim().replace(/\s+/g, ' ').toUpperCase())].filter(Boolean))].sort();

// Keep the existing string contract with the Auto Mail API. Saved values are
// unchanged until the user edits the selection; new selections use one order.
export function AutoMailScopePicker({ value, onChange, disabled, label, id }: {
  value: string; onChange: (value: string) => void; disabled?: boolean; label: string; id?: string;
}) {
  const [ports,setPorts] = useState(portOptions);
  useEffect(() => storage.subscribeToStorage?.(() => setPorts(portOptions())), []);
  const selected = [...new Set(value.split(/[,;/|]+/).map(port => port.trim().toUpperCase()).filter(Boolean))];
  const specific = selected.filter(port => port !== 'ALL');
  const existing = specific.filter(port => !ports.includes(port));
  const choices = [...ports, ...existing];
  const toggle = (port: string) => {
    if (port === 'ALL') { onChange('ALL'); return; }
    const next = specific.includes(port) ? specific.filter(item => item !== port) : [...specific, port];
    onChange(choices.filter(item => next.includes(item)).join(', ') || 'ALL');
  };
  return <fieldset id={id} aria-label={label} disabled={disabled} className="min-w-0 rounded-lg border border-slate-300 bg-white p-3 disabled:bg-slate-50 disabled:opacity-60">
    <legend className="px-1 text-xs font-medium text-slate-700">{label}</legend>
    <label className="flex min-h-9 cursor-pointer items-center gap-2 text-xs font-medium text-slate-700"><input type="checkbox" checked={!specific.length} onChange={() => toggle('ALL')} className="h-4 w-4 accent-sky-600" />ALL - general guidance</label>
    <div className="grid min-w-0 grid-cols-1 gap-x-3 sm:grid-cols-2">
      {choices.map(port => <label key={port} className="flex min-h-9 min-w-0 cursor-pointer items-center gap-2 text-xs text-slate-700"><input type="checkbox" checked={specific.includes(port)} onChange={() => toggle(port)} className="h-4 w-4 shrink-0 accent-sky-600" /><span className="break-words">{port}{existing.includes(port) ? ' (existing scope)' : ''}</span></label>)}
    </div>
    <p className="mt-1 text-[11px] font-normal text-slate-500">Select every port this guidance applies to. ALL clears the port selection.</p>
  </fieldset>;
}
