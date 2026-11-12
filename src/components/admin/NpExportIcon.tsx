export function NpExportIcon({ format }: { format: 'csv' | 'xlsx' | 'pdf' }) {
  return <svg aria-hidden="true" viewBox="0 0 32 40" className="h-6 w-5" fill="none">
    <path d="M4 1h15l10 10v26a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V3a2 2 0 0 1 2-2Z" fill="white" />
    <path d="M19 1v10h10" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
    {format === 'csv' ? <text x="15.5" y="29" textAnchor="middle" fill="currentColor" fontSize="10" fontWeight="800" fontFamily="Arial, sans-serif">CSV</text>
      : format === 'xlsx' ? <path d="m10 20 11 14m0-14L10 34" stroke="currentColor" strokeWidth="4" />
        : <path d="M9 33c6-8 10-17 7-18-4-1 1 12 9 14 6 1-8-7-16-1-7 6-3 9 0 5Z" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />}
  </svg>;
}
