import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';

export function NorthportContainerPagination({ current, total, disabled, loading, error, onRetry, onChange }: {
  current: number; total: number; disabled: boolean; loading: boolean; error: string;
  onRetry: () => void; onChange: (page: number) => void;
}) {
  const pages = Array.from(new Set([1, ...Array.from({length:3},(_,index) => current+index-1), total])).filter(page => page >= 1 && page <= total).sort((a,b) => a-b);
  const buttonClass = 'inline-flex h-7 min-w-7 items-center justify-center rounded-md px-1.5 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:opacity-40';
  return <div className="flex w-full flex-col items-center justify-center gap-1">
    <nav aria-label="Container pages" className="flex items-center justify-center gap-1">
      <button type="button" aria-label="Previous container" disabled={disabled || current <= 1} onClick={() => onChange(current-1)} className={buttonClass+' text-slate-600 hover:bg-slate-100'}><ChevronLeft aria-hidden="true" className="h-4 w-4"/></button>
      <span aria-label={`Container ${current} of ${total}`} className="whitespace-nowrap text-xs font-medium sm:hidden">{current}/{total}</span>
      {pages.map((page,index) => <span key={page} className="hidden items-center gap-1 sm:inline-flex">{index > 0 && page > pages[index-1]+1 && <span aria-hidden="true" className="text-slate-400">...</span>}<button type="button" aria-label={`Container ${page}`} aria-current={page === current ? 'page' : undefined} disabled={disabled} onClick={() => onChange(page)} className={buttonClass+(page === current ? ' bg-blue-600 font-semibold text-white' : ' text-slate-600 hover:bg-slate-100')}>{page}</button></span>)}
      <button type="button" aria-label="Next container" disabled={disabled || current >= total} onClick={() => onChange(current+1)} className={buttonClass+' text-slate-600 hover:bg-slate-100'}><ChevronRight aria-hidden="true" className="h-4 w-4"/></button>
      {loading && <Loader2 aria-label="Loading container pages" className="ml-1 h-3.5 w-3.5 animate-spin text-blue-600"/>}
    </nav>
    {error && <button type="button" title={error} onClick={onRetry} className="max-w-full truncate text-[10px] text-red-700 underline">Unable to load containers. Try again.</button>}
  </div>;
}
