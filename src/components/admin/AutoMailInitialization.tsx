import React, { useId } from 'react';
import { Check, AlertCircle } from 'lucide-react';
import { AUTO_MAIL_VERSION } from '../../constants/versions';
import type { MailInitializationProgress } from '../../services/autoMailInitialization';

export function AutoMailInitialization({ progress, error, onRetry }: { progress: MailInitializationProgress; error: string; onRetry: () => void }) {
  const gradient = useId();
  const percent = Math.round(progress.completed / Math.max(1, progress.steps.length) * 100);
  return <section aria-label="Initializing Auto Mail" className="flex h-[calc(100dvh-48px)] min-h-[400px] items-center justify-center bg-white px-6">
    <div className="w-full max-w-sm text-center">
      <svg viewBox="0 0 200 160" aria-hidden="true" className="mx-auto mb-10 h-32 w-40 sm:h-40 sm:w-48">
        <defs><linearGradient id={gradient} x1="0" y1="0" x2="1" y2="1"><stop stopColor="#ff579c"/><stop offset="0.5" stopColor="#ff4141"/><stop offset="1" stopColor="#ffbd00"/></linearGradient></defs>
        <path d="M25 135V35" fill="none" stroke="#4285f4" strokeWidth="28" strokeLinecap="round"/>
        <path d="M175 135V35" fill="none" stroke="#34a853" strokeWidth="28" strokeLinecap="round"/>
        <path d="M25 35L100 96L175 35" fill="none" stroke={`url(#${gradient})`} strokeWidth="30" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
      <div className="flex items-baseline justify-center gap-2"><h2 className="text-2xl font-semibold tracking-tight text-slate-800">AUTO MAIL</h2><span aria-label={`Auto Mail version ${AUTO_MAIL_VERSION}`} className="font-mono text-[11px] text-slate-400">v{AUTO_MAIL_VERSION}</span></div>
      <p className="mt-2 text-sm text-slate-500">Preparing your mailbox</p>
      <div role="progressbar" aria-label="Mailbox initialization progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-valuetext={`${progress.completed} of ${progress.steps.length} steps complete`} className="mt-7 h-1.5 overflow-hidden rounded-full bg-slate-100">
        <div className="h-full rounded-full bg-sky-500 transition-[width] duration-300 motion-reduce:transition-none" style={{width:`${percent}%`}}/>
      </div>
      <p aria-live="polite" className="mt-2 text-xs text-slate-400">{percent}%</p>
      <ul className="mt-5 space-y-2 text-left text-sm">
        {progress.steps.map(step => <li key={step.name} className="flex items-center gap-3 text-slate-500">
          {step.state === 'ready' ? <Check className="h-4 w-4 text-emerald-500"/> : step.state === 'error' ? <AlertCircle className="h-4 w-4 text-red-500"/> : <span className={`h-2 w-2 mx-1 rounded-full ${step.state === 'loading' ? 'bg-sky-400 motion-safe:animate-pulse' : 'bg-slate-200'}`}/>}
          <span>{step.name}</span><span className="ml-auto text-xs text-slate-400">{step.state === 'unavailable' ? 'Not configured' : step.state === 'ready' ? 'Ready' : step.state === 'loading' ? 'Loading' : step.state === 'error' ? 'Retry needed' : 'Waiting'}</span>
        </li>)}
      </ul>
      {error && <div className="mt-5"><p role="alert" className="text-sm text-red-700">{error}</p><button type="button" onClick={onRetry} className="mt-3 rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-700">Retry initialization</button></div>}
    </div>
  </section>;
}
