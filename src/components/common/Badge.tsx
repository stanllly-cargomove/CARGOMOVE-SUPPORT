import React from 'react';

export function StatusBadge({ status }: { status: string }) {
  switch (status) {
    case 'ACTIVE':
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
          Active
        </span>
      );
    case 'INACTIVE':
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-600 border border-slate-200">
          Inactive
        </span>
      );
    case 'PENDING':
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200">
          Pending
        </span>
      );
    case 'DONE':
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
          Done
        </span>
      );
    case 'REJECTED':
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-rose-50 text-rose-700 border border-rose-200">
          Rejected
        </span>
      );
    default:
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-700 border border-slate-200">
          {status}
        </span>
      );
  }
}

export function TypeBadge({ type }: { type: string }) {
  const colors: Record<string, string> = {
    COMPANY: 'bg-indigo-50 text-indigo-700 border-indigo-200',
    DRIVER: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    TRAILER: 'bg-amber-50 text-amber-700 border-amber-200',
    VEHICLE: 'bg-sky-50 text-sky-700 border-sky-200',
  };

  const className = colors[type] || 'bg-slate-50 text-slate-700 border-slate-200';

  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium border ${className}`}>
      {type}
    </span>
  );
}

export function PortBadge({ location }: { location: string }) {
  if (location === 'PORT_KLANG') {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-50 text-blue-700 border border-blue-200">
        Port Klang
      </span>
    );
  }
  if (location === 'OTHER') {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-amber-50 text-amber-700 border border-amber-200">
        Other Port
      </span>
    );
  }
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-purple-50 text-purple-700 border border-purple-200">
      Johor
    </span>
  );
}
