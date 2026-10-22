import React from 'react';

export function AutoMailSkeleton({ reader = false }: { reader?: boolean }) {
  return <div role="status" aria-label={reader ? 'Loading conversation' : 'Loading emails'} className="motion-safe:animate-pulse">
    <span className="sr-only">{reader ? 'Loading conversation' : 'Loading emails'}</span>
    <div aria-hidden="true">
      {Array.from({ length: reader ? 4 : 10 }, (_, index) => <div key={index} className={`flex items-center gap-4 border-b border-slate-100 px-4 ${reader ? 'py-6' : 'py-3'}`}>
        <div className={`${reader ? 'h-9 w-9 rounded-full' : 'h-4 w-4 rounded'} shrink-0 bg-slate-200`} />
        <div className="flex min-w-0 flex-1 flex-col gap-2 md:flex-row md:items-center md:gap-6">
          <div className="h-3 w-28 shrink-0 rounded bg-slate-200" />
          <div className={`h-3 rounded bg-slate-100 ${index % 2 ? 'w-1/2' : 'w-3/4'}`} />
        </div>
        <div className="h-3 w-10 shrink-0 rounded bg-slate-100" />
      </div>)}
    </div>
  </div>;
}
