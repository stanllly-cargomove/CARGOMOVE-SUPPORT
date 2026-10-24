import React from 'react';

export function CargoMoveIdBadge({ id }: { id: string }) {
  const displayId = id.length > 8 ? `${id.slice(0, 4)}...${id.slice(-4)}` : id;

  return (
    <span
      className="inline-flex items-center rounded-full border border-slate-200 bg-slate-100 px-2 py-0.5 font-mono text-xs font-semibold text-slate-700"
      title={`CargoMove ID: ${id}`}
      aria-label={`CargoMove ID: ${id}`}
    >
      {displayId}
    </span>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const positive = ['DONE', 'SUCCESS', 'REGISTERED', 'ACTIVE'].includes(status);
  const colors = status === 'PENDING' ? 'bg-amber-50 text-amber-700 border-amber-200'
    : status === 'REJECTED' ? 'bg-rose-50 text-rose-700 border-rose-200'
    : positive ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
    : 'bg-slate-100 text-slate-600 border-slate-200';
  const label = { ACTIVE: 'Active', INACTIVE: 'Inactive', PENDING: 'Pending', DONE: 'Done',
    SUCCESS: 'Successful', REGISTERED: 'Registered', REJECTED: 'Rejected' }[status] || status;
  return <span className={`inline-flex h-6 w-[104px] shrink-0 items-center justify-center whitespace-nowrap rounded-full border px-2 text-[10px] font-semibold uppercase ${colors}`}>{label}</span>;
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
