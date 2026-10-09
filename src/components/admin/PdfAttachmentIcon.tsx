import { FileText } from 'lucide-react';

export function PdfAttachmentIcon() {
  return (
    <span aria-hidden="true" className="relative flex h-9 w-8 shrink-0 items-center justify-center rounded-md border border-rose-200 bg-rose-50 text-rose-700">
      <FileText className="h-6 w-6" strokeWidth={1.8} />
      <span className="absolute -bottom-1 rounded bg-rose-600 px-0.5 text-[7px] font-bold leading-3 text-white">PDF</span>
    </span>
  );
}
