import React from 'react';
import { BookOpen, Clock3 } from 'lucide-react';

export function GuidelineManager() {
  return (
    <div className="w-full space-y-6">
      <div>
        <h2 className="text-xl font-bold tracking-tight text-slate-900">Haulier Guidelines</h2>
        <p className="mt-1 text-xs text-slate-500">A dedicated space to manage guidance and resources for hauliers.</p>
      </div>

      <section aria-labelledby="guideline-manager-heading" className="flex min-h-[380px] items-center justify-center rounded-xl border border-slate-200 bg-white px-6 py-12 shadow-sm sm:min-h-[460px] sm:py-16">
        <div className="max-w-md text-center">
          <div className="relative mx-auto mb-7 flex h-20 w-20 items-center justify-center rounded-2xl border border-sky-100 bg-sky-50 text-sky-600">
            <BookOpen className="h-9 w-9" strokeWidth={1.5} aria-hidden="true" />
            <span className="absolute -bottom-2 -right-2 flex h-8 w-8 items-center justify-center rounded-full border-4 border-white bg-sky-100 text-sky-700"><Clock3 className="h-4 w-4" aria-hidden="true" /></span>
          </div>
          <span className="inline-flex rounded-full border border-sky-100 bg-sky-50 px-3 py-1 text-[11px] font-semibold text-sky-700">Coming soon</span>
          <h3 id="guideline-manager-heading" className="mt-4 text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl">Haulier guidance, all in one place.</h3>
          <p className="mx-auto mt-3 max-w-sm text-sm leading-6 text-slate-500">We’re preparing this space to help you manage haulier guidelines. It’s still being built, so check back later to get started.</p>
        </div>
      </section>
    </div>
  );
}
