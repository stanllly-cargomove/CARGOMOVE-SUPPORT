import React, { useId, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Company, RegistrationSubmission, SubmissionStatus } from '../../types';
import { companyRegistrationStatus } from '../../../shared/registration-eligibility';

export function QueueCompanyName({ submission, company, submissions, registrationStatus, highlight, className = '' }: {
  submission: RegistrationSubmission; company?: Company; submissions: RegistrationSubmission[];
  registrationStatus?: SubmissionStatus;
  highlight: boolean; className?: string;
}) {
  const tooltipId = useId();
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const status = registrationStatus || (company ? companyRegistrationStatus(company, submissions) : 'PENDING');
  const warning = highlight && submission.registration_type !== 'COMPANY' && status !== 'DONE';
  const message = status === 'REJECTED' ? 'company registration rejected' : 'company is not registered yet';
  const show = (event: React.MouseEvent<HTMLElement> | React.FocusEvent<HTMLElement>) => {
    if (!warning) return;
    const box = event.currentTarget.getBoundingClientRect();
    setPosition({ left: Math.max(8, Math.min(box.left, window.innerWidth - 260)), top: Math.max(8, box.top - 34) });
  };
  return <>
    <span className={`admin-registration-copy-text font-bold ${warning ? status === 'REJECTED' ? 'text-red-600' : 'text-orange-600' : 'text-slate-900'} ${className}`}
      tabIndex={warning ? 0 : undefined} title={warning ? '' : submission.company_name} aria-describedby={warning && position ? tooltipId : undefined}
      onMouseEnter={show} onMouseLeave={() => setPosition(null)} onFocus={show} onBlur={() => setPosition(null)}>
      {submission.company_name.toUpperCase()}
    </span>
    {warning && position && createPortal(<span id={tooltipId} role="tooltip" style={position}
      className="pointer-events-none fixed z-[70] max-w-[252px] rounded-md bg-slate-900 px-2.5 py-1.5 text-[11px] leading-4 text-white shadow-lg">{message}</span>, document.body)}
  </>;
}
