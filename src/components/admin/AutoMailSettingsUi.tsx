import React from 'react';
export type SettingsStatus = { busy: boolean; ready: boolean; error: boolean };

export const settingsInput = 'h-10 w-full min-w-0 rounded-lg border border-slate-300 bg-white px-3 text-xs text-slate-800 outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-100 disabled:bg-slate-50 disabled:text-slate-400';
export const settingsSecondary = 'inline-flex h-9 shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40';

export function SettingsCard({ title, description, icon, badge, children, label }: { title: string; description: string; icon: React.ReactNode; badge?: React.ReactNode; children: React.ReactNode; label: string }) {
  return <section aria-label={label} className="min-w-0 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
    <header className="flex items-start gap-3 border-b border-slate-200 px-4 py-4 sm:px-5">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-sky-50 text-sky-700" aria-hidden="true">{icon}</span>
      <div className="min-w-0 flex-1"><h3 className="text-sm font-semibold text-slate-900">{title}</h3><p className="mt-1 text-xs leading-5 text-slate-500">{description}</p></div>
      {badge && <span className="shrink-0 rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-semibold text-slate-600">{badge}</span>}
    </header>
    {children}
  </section>;
}

export function SettingsToggle({ label, displayLabel, description, checked, disabled, onChange }: { label: string; displayLabel?: string; description: string; checked: boolean; disabled?: boolean; onChange: (checked: boolean) => void }) {
  return <label className={`flex min-w-0 items-center justify-between gap-5 ${disabled ? 'cursor-default' : 'cursor-pointer'}`}>
    <span className="min-w-0"><span className="block text-xs font-semibold text-slate-800">{displayLabel || label}</span><span className="mt-1 block text-xs leading-5 text-slate-500">{description}</span></span>
    <span className="relative inline-flex h-6 w-11 shrink-0">
      <input type="checkbox" aria-label={label} checked={checked} disabled={disabled} onChange={event => onChange(event.target.checked)} className="peer absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0 disabled:cursor-default" />
      <span aria-hidden="true" className="pointer-events-none h-6 w-11 rounded-full bg-slate-300 transition-colors peer-checked:bg-sky-600 peer-focus-visible:ring-2 peer-focus-visible:ring-sky-500 peer-focus-visible:ring-offset-2 peer-disabled:opacity-40" />
      <span aria-hidden="true" className="pointer-events-none absolute left-1 top-1 h-4 w-4 rounded-full bg-white shadow-sm transition-transform peer-checked:translate-x-5" />
    </span>
  </label>;
}

export function SettingsActions({ dirty, busy, saveDisabled, saveLabel }: { dirty: boolean; busy: boolean; saveDisabled: boolean; saveLabel: string }) {
  return <footer aria-label={saveLabel + ' actions'} className="flex flex-nowrap items-center justify-between gap-3 border-t border-slate-200 bg-slate-50/70 px-4 py-3 sm:px-5">
    <span className={`hidden text-xs sm:block ${dirty ? 'text-amber-700' : 'text-slate-400'}`}>{dirty ? 'Unsaved changes' : 'No unsaved changes'}</span>
    <div className="ml-auto flex shrink-0 flex-nowrap items-center gap-2">
      <button type="submit" aria-label={saveLabel} disabled={saveDisabled} className="inline-flex h-9 w-28 shrink-0 items-center justify-center whitespace-nowrap rounded-lg bg-sky-600 px-3 text-xs font-semibold text-white hover:bg-sky-700 disabled:opacity-40">{busy ? 'Saving...' : 'Save changes'}</button>
    </div>
  </footer>;
}
