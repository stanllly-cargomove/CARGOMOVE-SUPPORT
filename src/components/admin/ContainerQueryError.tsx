import { RefreshCw, Search, WifiOff } from 'lucide-react';

interface ContainerQueryErrorProps {
  id: string;
  port: string;
  message: string;
  hasResults: boolean;
  disabled: boolean;
  onRetry: () => void;
}

export function ContainerQueryError({ id, port, message, hasResults, disabled, onRetry }: ContainerQueryErrorProps) {
  return <section id={id} role="alert" aria-labelledby={`${id}-title`} className="overflow-hidden rounded-xl border border-slate-200 bg-white px-5 py-8 text-center shadow-sm sm:py-10">
    <div aria-hidden="true" className="relative mx-auto mb-5 h-28 w-44">
      <div className="absolute inset-x-4 bottom-0 h-20 rounded-full bg-sky-50" />
      <div className="container-query-float absolute left-7 top-7 flex h-16 w-28 items-center justify-evenly rounded-lg border-2 border-sky-200 bg-white shadow-sm">
        {[0, 1, 2, 3, 4].map(index => <span key={index} className="h-10 w-1 rounded-full bg-sky-100" />)}
      </div>
      <div className="container-query-scan absolute bottom-0 right-4 flex h-12 w-12 items-center justify-center rounded-full border-4 border-white bg-sky-600 text-white shadow-sm"><Search className="h-6 w-6" /></div>
      <div className="absolute right-7 top-0 flex h-8 w-8 items-center justify-center rounded-full border border-amber-100 bg-amber-50 text-amber-600"><WifiOff className="h-4 w-4" /></div>
    </div>
    <h3 id={`${id}-title`} className="text-base font-semibold text-slate-900">Unable to load {port} records</h3>
    <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-slate-500">We couldn’t retrieve the container movements. Please try again in a moment, or check the container number.</p>
    {hasResults && <p className="mt-2 text-xs font-medium text-sky-700">Showing the last successful query below.</p>}
    <button type="button" disabled={disabled} onClick={onRetry} className="mt-5 inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-sky-600 px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-sky-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"><RefreshCw aria-hidden="true" className="h-4 w-4" />Try again</button>
    <details className="mx-auto mt-4 max-w-md text-xs text-slate-500">
      <summary className="mx-auto w-fit cursor-pointer rounded px-2 py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500">View error details</summary>
      <p className="mt-2 break-words rounded-lg bg-slate-50 p-3 leading-relaxed">{message}</p>
    </details>
  </section>;
}
