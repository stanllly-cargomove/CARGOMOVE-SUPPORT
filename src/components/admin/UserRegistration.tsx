import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, Download, EllipsisVertical, Info, Mail, Pencil, Save, Search, UsersRound, X } from 'lucide-react';
import { getExternalUserAccess, ExternalUserAccess, updateExternalUserAccess } from '../../services/auth';
import { EmailPreview, EmailTemplate, EmailTemplatePort, generateWelcomeEmailPreview, getEmailTemplateCatalog, sendWelcomeEmail } from '../../services/email';
import { RichTextEmailEditor } from './RichTextEmailEditor';
import { notifyError, notifySuccess } from '../common/notifications';
import { getSubmissions, subscribeToStorage } from '../../services/storage';
import { isEmailTemplateForRegistration } from '../../utils/registrationEmailTemplates';

const statuses: ExternalUserAccess['status'][] = ['PENDING', 'DONE', 'REJECTED'];
const emailStatuses: ExternalUserAccess['email_status'][] = ['NOT_READY', 'READY', 'SENDING', 'SENT', 'FAILED'];
type EditableUserField = 'username' | 'email' | 'password' | 'company_name' | 'full_name' | 'mobile_number' | 'status' | 'email_status';
const MINIMUM_VISIBLE_ROWS = 4;
const USER_ROW_HEIGHT = 32;

const statusTabColors: Record<ExternalUserAccess['status'], string> = {
  PENDING: 'text-amber-700',
  DONE: 'text-emerald-700',
  REJECTED: 'text-rose-700',
};

const statusSelectClasses: Record<ExternalUserAccess['status'], string> = {
  PENDING: 'border-amber-300 bg-amber-50 text-amber-700',
  DONE: 'border-emerald-300 bg-emerald-50 text-emerald-700',
  REJECTED: 'border-rose-300 bg-rose-50 text-rose-700',
};

function emailStatusLabel(status: ExternalUserAccess['email_status']) {
  return status === 'SENT' ? 'DONE' : status;
}

function emailStatusClasses(status: ExternalUserAccess['email_status']) {
  if (status === 'READY') return 'border-amber-300 bg-amber-50 text-amber-700';
  if (status === 'SENT') return 'border-emerald-300 bg-emerald-50 text-emerald-700';
  if (status === 'SENDING') return 'border-blue-300 bg-blue-50 text-blue-700';
  if (status === 'FAILED') return 'border-rose-300 bg-rose-50 text-rose-700';
  return 'border-slate-200 bg-slate-50 text-slate-600';
}

function getVisiblePageNumbers(currentPage: number, totalPages: number): number[] {
  const visibleCount = Math.min(5, totalPages);
  const start = Math.min(
    Math.max(1, currentPage - Math.floor(visibleCount / 2)),
    totalPages - visibleCount + 1,
  );
  return Array.from({ length: visibleCount }, (_, index) => start + index);
}

const copyPlainText = async (value: string, label: string) => {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
    } else {
      const textarea = document.createElement('textarea');
      textarea.value = value;
      textarea.setAttribute('readonly', '');
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      const copied = document.execCommand('copy');
      textarea.remove();
      if (!copied) throw new Error('Copy command was unavailable.');
    }
    notifySuccess(`${label} copied to clipboard.`);
  } catch {
    notifyError(`Unable to copy ${label.toLowerCase()}.`);
  }
};

interface CopyableValueProps {
  value: string;
  label: string;
  className?: string;
}

function CopyableValue({ value, label, className = '' }: CopyableValueProps) {
  const copyValue = () => void copyPlainText(value, label);

  return (
    <span
      role="button"
      tabIndex={0}
      onDoubleClick={copyValue}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          copyValue();
        }
      }}
      className={`block cursor-copy select-none truncate rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${className}`}
      title={`${value}\nDouble-click to copy ${label.toLowerCase()}`}
      aria-label={`${value}. Double-click or press Enter to copy ${label.toLowerCase()}`}
    >
      {value}
    </span>
  );
}

function UserActionMenu({ username, canResend, loading, onEdit, onResend }: {
  username: string;
  canResend: boolean;
  loading: boolean;
  onEdit: () => void;
  onResend: () => void;
}) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [position, setPosition] = useState({ top: -9999, left: -9999 });

  useLayoutEffect(() => {
    if (!isOpen || !triggerRef.current || !menuRef.current) return;
    const trigger = triggerRef.current.getBoundingClientRect();
    const menu = menuRef.current.getBoundingClientRect();
    const gap = 4;
    const padding = 8;
    const top = trigger.bottom + gap + menu.height <= window.innerHeight - padding
      ? trigger.bottom + gap
      : Math.max(padding, trigger.top - menu.height - gap);
    const left = Math.min(Math.max(padding, trigger.right - menu.width), window.innerWidth - menu.width - padding);
    setPosition({ top, left });
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const close = () => setIsOpen(false);
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') close(); };
    window.addEventListener('resize', close);
    window.addEventListener('scroll', close, true);
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [isOpen]);

  return <>
    <button ref={triggerRef} type="button" onClick={() => setIsOpen((value) => !value)} aria-label={`Actions for ${username}`} aria-haspopup="menu" aria-expanded={isOpen} title={`Actions for ${username}`} className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-600 transition-colors hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700">
      <EllipsisVertical className="h-4 w-4" aria-hidden="true" />
    </button>
    {isOpen && typeof document !== 'undefined' && createPortal(<>
      <button type="button" tabIndex={-1} aria-label="Close actions" className="fixed inset-0 z-[70] h-full w-full cursor-default bg-transparent" onClick={() => setIsOpen(false)} />
      <div ref={menuRef} role="menu" aria-label={`Actions for ${username}`} style={{ top: position.top, left: position.left }} className="fixed z-[80] w-36 rounded-lg border border-slate-200 bg-white p-1 shadow-lg">
        <button type="button" role="menuitem" onClick={() => { setIsOpen(false); onEdit(); }} className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-[11px] font-medium text-slate-700 hover:bg-slate-50"><Pencil className="h-3.5 w-3.5 text-slate-500" />Edit User</button>
        <button type="button" role="menuitem" onClick={() => { setIsOpen(false); onResend(); }} disabled={!canResend || loading} title={canResend ? 'Preview and resend the registration email' : 'Close the registration before sending email'} className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-[11px] font-medium text-blue-700 hover:bg-blue-50 disabled:cursor-not-allowed disabled:text-slate-400"><Mail className="h-3.5 w-3.5" />{loading ? 'Loading...' : 'Resend Email'}</button>
      </div>
    </>, document.body)}
  </>;
}

function CompanyRegistrationWarning({ user, onClose }: {
  user: ExternalUserAccess; onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  return <dialog ref={dialogRef} role="alertdialog" aria-labelledby="company-registration-warning-title" aria-describedby="company-registration-warning-description" onCancel={event => { event.preventDefault(); onClose(); }} className="m-auto w-[calc(100vw-2rem)] max-w-lg rounded-2xl border border-slate-200 bg-white p-5 text-slate-900 shadow-2xl backdrop:bg-slate-900/55">
    <div className="flex items-center gap-2"><AlertTriangle aria-hidden="true" className="h-5 w-5 shrink-0 text-amber-700" /><h3 id="company-registration-warning-title" className="text-base font-bold">Company registration not completed</h3></div>
    <div id="company-registration-warning-description" className="mt-3 space-y-3 text-sm leading-6 text-slate-700">
      <p>Cannot mark <strong>{user.username}</strong> as Done because <strong>{user.company_name || 'the linked company'}</strong> is not registered. Please complete the company registration first.</p>
      <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-800">Marking the user as Done before the company is registered may cause login, company access, or registration issues in CargoMove. An acceptance email cannot be prepared until the linked company registration is completed.</p>
      <p>After the company registration is completed, return here to mark the user as Done and prepare the acceptance email.</p>
    </div>
    <div className="mt-5 flex justify-start"><button type="button" autoFocus onClick={onClose} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100">Close</button></div>
  </dialog>;
}

export function UserRegistration() {
  const [users, setUsers] = useState<ExternalUserAccess[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [registrationStatusFilter, setRegistrationStatusFilter] = useState<ExternalUserAccess['status']>('PENDING');
  const [emailStatusFilter, setEmailStatusFilter] = useState<'ALL' | ExternalUserAccess['email_status']>('ALL');
  const [savingKeys, setSavingKeys] = useState<Set<string>>(new Set());
  const [loadError, setLoadError] = useState('');
  const [preview, setPreview] = useState<EmailPreview | null>(null);
  const [previewUserId, setPreviewUserId] = useState('');
  const [openingPreview, setOpeningPreview] = useState('');
  const [codeUser, setCodeUser] = useState<ExternalUserAccess | null>(null);
  const [codeTemplates, setCodeTemplates] = useState<EmailTemplate[]>([]);
  const [codePorts, setCodePorts] = useState<EmailTemplatePort[]>([]);
  const [codeAction, setCodeAction] = useState<'PREVIEW' | 'REJECT'>('PREVIEW');
  const [selectedTemplateId, setSelectedTemplateId] = useState('__choose__');
  const [sending, setSending] = useState(false);
  const [editingUser, setEditingUser] = useState<ExternalUserAccess | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [blockedUser, setBlockedUser] = useState<ExternalUserAccess | null>(null);
  const [pageSize] = useState(20);
  const [currentPage, setCurrentPage] = useState(1);

  useEffect(() => {
    let isMounted = true;
    const loadUsers = () => void getExternalUserAccess().then((records) => {
      if (isMounted) {
        setUsers(records);
        setLoadError('');
      }
    }).catch((error) => {
      if (isMounted) {
        setUsers([]);
        setLoadError(error instanceof Error ? error.message : 'Unable to load company users.');
      }
    });
    loadUsers();
    const unsubscribe = subscribeToStorage(loadUsers);
    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, registrationStatusFilter, emailStatusFilter, pageSize]);

  const updateUser = async (user: ExternalUserAccess, changes: Partial<Pick<ExternalUserAccess, 'status' | 'rejection_reason' | 'rejection_detail'>>) => {
    const key = `${user.id}-${Object.keys(changes)[0]}`;
    const previous = { ...(users.find((item) => item.id === user.id) || user) };
    setSavingKeys((current) => new Set(current).add(key));
    setUsers((current) => current.map((item) => item.id === user.id ? { ...item, ...changes } : item));
    try {
      const saved = await updateExternalUserAccess(user.id, changes);
      setUsers((current) => current.map((item) => item.id === user.id ? { ...item, ...saved } : item));
      notifySuccess('Registration status updated.');
      return saved;
    } catch (error) {
      setUsers((current) => current.map((item) => item.id === user.id ? previous : item));
      notifyError(error instanceof Error ? error.message : 'Unable to update registration.');
      return null;
    } finally {
      setSavingKeys((current) => {
        const next = new Set(current);
        next.delete(key);
        return next;
      });
    }
  };

  const companyPortIdsFor = (user: ExternalUserAccess, acceptedOnly: boolean) => user.company_id ? [...new Set(getSubmissions()
    .filter((submission) => submission.registration_type === 'COMPANY' && submission.company_id === user.company_id && (!acceptedOnly || submission.status === 'DONE'))
    .map((submission) => ['jh-pg-ics', 'jh-pg-depot'].includes(submission.port_id) ? 'johor-port' : submission.port_id)
    .filter(Boolean))] : [];

  const previewWithCode = async (user: ExternalUserAccess, template: EmailTemplate, portId: string, rejectUser: boolean) => {
    let target = user;
    if (rejectUser) {
      const saved = await updateUser(user, {
        status: 'REJECTED',
        rejection_reason: template.rejection_reason || 'OTHER',
        rejection_detail: template.name,
      });
      if (!saved) return;
      target = saved;
      if (codeUser?.id === user.id) {
        setCodeAction('PREVIEW');
        setCodeUser(saved);
      }
    }
    const generated = await generateWelcomeEmailPreview(target.id, template.id, portId);
    setPreviewUserId(target.id);
    setPreview(generated);
    setCodeUser(null);
  };

  const startUserCodeFlow = async (user: ExternalUserAccess, outcome: 'DONE' | 'REJECTED', rejectUser = false) => {
    setOpeningPreview(user.id);
    try {
      const catalog = await getEmailTemplateCatalog();
      const portIds = companyPortIdsFor(user, outcome === 'DONE');
      if (!portIds.length) throw new Error(outcome === 'DONE'
        ? 'Register the linked company before previewing or sending its acceptance email.'
        : 'This user has no linked Company Registration port for a rejection code.');
      const choices = portIds.flatMap((portId) => catalog.templates
        .filter((template) => template.active && template.template_code && template.trigger_status === outcome && template.port_ids?.includes(portId) && isEmailTemplateForRegistration(template, 'COMPANY')
          && (rejectUser || outcome !== 'REJECTED' || !template.rejection_reason || template.rejection_reason === user.rejection_reason))
        .map((template) => ({ template, portId })));
      if (!choices.length) throw new Error(`No active ${outcome === 'DONE' ? 'acceptance' : 'rejection'} code is assigned to the linked company port. Assign one in Registration Templates.`);
      if (choices.length === 1) {
        await previewWithCode(user, choices[0].template, choices[0].portId, rejectUser);
      } else {
        setCodeUser(rejectUser ? { ...user, status: 'REJECTED' } : user);
        setCodeTemplates(catalog.templates);
        setCodePorts(catalog.ports.filter((port) => portIds.includes(port.id)));
        setCodeAction(rejectUser ? 'REJECT' : 'PREVIEW');
        setSelectedTemplateId('__choose__');
      }
    } catch (error) {
      notifyError(error instanceof Error ? error.message : 'Unable to prepare the registration email.');
    } finally {
      setOpeningPreview('');
    }
  };

  const openPreview = async (user: ExternalUserAccess) => {
    if (user.status !== 'DONE' && user.status !== 'REJECTED') return;
    await startUserCodeFlow(user, user.status);
  };

  const openSelectedPreview = async () => {
    if (!codeUser || selectedTemplateId === '__choose__') return;
    setOpeningPreview(codeUser.id);
    try {
      const [templateId, portId] = selectedTemplateId.split('::');
      const template = codeTemplates.find((item) => item.id === templateId && item.port_ids?.includes(portId));
      if (!template || !portId) throw new Error('Select a valid code and company port.');
      await previewWithCode(codeUser, template, portId, codeAction === 'REJECT');
    } catch (error) {
      notifyError(error instanceof Error ? error.message : 'Unable to generate the email preview.');
    } finally {
      setOpeningPreview('');
    }
  };

  const changeStatus = async (user: ExternalUserAccess, status: ExternalUserAccess['status']) => {
    if (status === 'DONE' && !companyPortIdsFor(user, true).length) {
      setBlockedUser(user);
      return;
    }
    if (status === 'REJECTED') {
      await startUserCodeFlow(user, 'REJECTED', true);
      return;
    }
    const saved = await updateUser(user, { status });
    if (saved?.status === 'DONE' && companyPortIdsFor(saved, true).length) await openPreview(saved);
  };

  const saveUserDetails = async (event: React.FormEvent) => {
    event.preventDefault();
    const user = editingUser;
    if (!user) return;
    const requiredValues = [user.username, user.email, user.password, user.full_name, user.mobile_number];
    if (requiredValues.some((value) => !value.trim())) {
      notifyError('Username, email, password, full name, and mobile number are required.');
      return;
    }

    const previousStatus = users.find((record) => record.id === user.id)?.status;
    if (user.status === 'DONE' && !companyPortIdsFor(user, true).length) {
      setBlockedUser(user);
      return;
    }
    setSavingEdit(true);
    try {
      const saved = await updateExternalUserAccess(user.id, {
        username: user.username,
        email: user.email,
        password: user.password,
        company_name: user.company_name.trim().toUpperCase(),
        full_name: user.full_name,
        mobile_number: user.mobile_number,
        status: user.status,
        ...(['DONE', 'REJECTED'].includes(user.status) ? { email_status: user.email_status === 'SENT' ? 'SENT' : 'READY' } : {}),
        rejection_reason: user.status === 'REJECTED' ? user.rejection_reason : undefined,
        rejection_detail: user.status === 'REJECTED' ? user.rejection_detail : undefined,
      });
      setUsers((current) => current.map((user) => user.id === saved.id ? { ...user, ...saved } : user));
      setEditingUser(null);
      notifySuccess('User details updated in the database.');
      if (previousStatus !== 'DONE' && saved.status === 'DONE' && companyPortIdsFor(saved, true).length) await openPreview(saved);
    } catch (error) {
      notifyError(error instanceof Error ? error.message : 'Unable to update user details.');
    } finally {
      setSavingEdit(false);
    }
  };

  const changeEditField = (field: EditableUserField, value: string) => {
    setEditingUser((current) => current ? { ...current, [field]: value } : current);
  };

  const sendPreview = async () => {
    if (!preview) return;
    setSending(true);
    try {
      await sendWelcomeEmail(preview);
      setUsers((current) => current.map((item) => item.id === previewUserId
        ? { ...item, email_status: 'SENT', email_sent: 1 }
        : item));
      setPreview(null);
      notifySuccess('Registration email sent through Gmail.');
    } catch (error) {
      setUsers((current) => current.map((item) => item.id === previewUserId
        ? { ...item, email_status: 'FAILED', email_sent: 0 }
        : item));
      notifyError(error instanceof Error ? error.message : 'Unable to send the welcome email.');
    } finally {
      setSending(false);
    }
  };

  const filteredUsers = users
    .filter((user) => {
      const term = searchTerm.toLowerCase();
      const resolvedEmailStatus = user.email_status || (['DONE', 'REJECTED'].includes(user.status) ? 'READY' : 'NOT_READY');
      const matchesSearch = !term || [
        user.username,
        user.email,
        user.company_name,
        user.full_name,
        user.mobile_number,
        user.status,
        resolvedEmailStatus,
      ].some((value) => String(value || '').toLowerCase().includes(term));
      return matchesSearch
        && user.status === registrationStatusFilter
        && (emailStatusFilter === 'ALL' || resolvedEmailStatus === emailStatusFilter);
    })
    .sort((left, right) => {
      const rejectionDifference = Number(left.status === 'REJECTED') - Number(right.status === 'REJECTED');
      const dateDifference = Date.parse(right.created_at) - Date.parse(left.created_at);
      return rejectionDifference || dateDifference || right.id.localeCompare(left.id);
    });
  const userCountByStatus = (status: ExternalUserAccess['status']) =>
    users.filter((user) => user.status === status).length;
  const totalPages = Math.max(1, Math.ceil(filteredUsers.length / pageSize));
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const pageStart = (safeCurrentPage - 1) * pageSize;
  const paginatedUsers = filteredUsers.slice(pageStart, pageStart + pageSize);
  const userSpacerHeight = Math.max(0, MINIMUM_VISIBLE_ROWS - paginatedUsers.length) * USER_ROW_HEIGHT;
  const pageNumbers = getVisiblePageNumbers(safeCurrentPage, totalPages);

  useEffect(() => {
    if (currentPage > totalPages) setCurrentPage(totalPages);
  }, [currentPage, totalPages]);

  const downloadReport = () => {
    if (!filteredUsers.length) {
      notifyError('There are no registration records to download.');
      return;
    }
    const csvValue = (value: unknown) => {
      let text = String(value ?? '');
      if (/^[=+\-@]/.test(text)) text = `'${text}`;
      return `"${text.replace(/"/g, '""')}"`;
    };
    const rows = filteredUsers.map((user) => [
      user.username,
      user.email,
      user.password,
      user.company_name.toUpperCase(),
      user.full_name,
      user.mobile_number,
      user.status,
      user.email_status || (['DONE', 'REJECTED'].includes(user.status) ? 'READY' : 'NOT_READY'),
    ]);
    const csv = [
      ['Username', 'Email Address', 'Password', 'Company', 'Full Name', 'Mobile Number', 'Registration Status', 'Email Status'],
      ...rows,
    ].map((row) => row.map(csvValue).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `user-registration-report-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    notifySuccess('Registration report downloaded.');
  };

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2">
          <h2 className="text-xl font-bold text-slate-900 tracking-tight">User Registration</h2>
          <div className="group relative">
            <button
              type="button"
              aria-label="User Registration table information"
              className="flex h-5 w-5 items-center justify-center rounded-full text-blue-600 outline-none transition-colors hover:bg-blue-50 hover:text-blue-700 focus-visible:ring-2 focus-visible:ring-blue-500"
            >
              <Info className="h-4 w-4" />
            </button>
            <div
              role="tooltip"
              className="pointer-events-none absolute left-1/2 top-full z-20 mt-2 hidden w-64 -translate-x-1/2 rounded-lg bg-slate-900 px-3 py-2 text-center text-[11px] font-medium leading-relaxed text-white shadow-lg group-hover:block group-focus-within:block"
            >
              Double-click any text value to copy the complete value to your clipboard as plain text.
            </div>
          </div>
        </div>
        <p className="text-xs text-slate-500 mt-1">Users registered through the company registration form.</p>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm sm:p-4">
        <div className="flex min-w-0 items-center gap-2 sm:gap-3">
          <div className="relative min-w-0 flex-1">
            <input
              type="text"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="Search username, email, company or name..."
              className="h-8 w-full min-w-0 rounded-lg border border-slate-300 px-2.5 pl-8 text-[10px] focus:border-slate-400 focus:outline-none focus:ring-0 sm:h-9 sm:px-3.5 sm:pl-9 sm:text-xs"
            />
            <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-slate-400 sm:left-3 sm:top-2.5 sm:h-4 sm:w-4" />
          </div>
          <select
            value={emailStatusFilter}
            onChange={(event) => setEmailStatusFilter(event.target.value as 'ALL' | ExternalUserAccess['email_status'])}
            className="h-8 w-32 shrink-0 rounded-lg border border-slate-300 bg-white px-2 text-[9px] font-semibold uppercase text-slate-700 focus:border-slate-400 focus:outline-none focus:ring-0 sm:h-9 sm:w-44 sm:px-3 sm:text-xs"
            aria-label="Filter by email status"
          >
            <option value="ALL">ALL EMAIL STATUSES</option>
            {emailStatuses.map((status) => <option key={status} value={status}>{status}</option>)}
          </select>
          <button
            type="button"
            onClick={downloadReport}
            aria-label="Download registration report"
            title="Download registration report"
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center gap-1 whitespace-nowrap rounded-lg bg-blue-600 text-[9px] font-bold text-white transition-colors hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 sm:h-9 sm:w-auto sm:px-2.5 sm:text-[10px]"
          >
            <Download className="h-3.5 w-3.5 shrink-0 sm:h-3 sm:w-3" />
            <span className="hidden sm:inline">DOWNLOAD REPORT</span>
          </button>
        </div>
      </div>

      <div className="rounded-xl">
        <div>
          <div className="ml-[0.5px] flex w-fit items-end" role="tablist" aria-label="User registration status">
            {([
              ['PENDING', 'Pending'],
              ['DONE', 'Closed / Done'],
              ['REJECTED', 'Rejected'],
            ] as const).map(([value, label]) => {
              const statusCount = userCountByStatus(value);
              const isPendingTab = value === 'PENDING';

              return (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={registrationStatusFilter === value}
                aria-label={`${label}: ${statusCount} registration${statusCount === 1 ? '' : 's'}`}
                onClick={() => setRegistrationStatusFilter(value)}
                className={`admin-registration-tab relative -mr-px flex h-10 w-[132px] min-w-[132px] items-center justify-center rounded-t-lg border px-3 text-xs font-bold uppercase tracking-wider transition-colors ${
                  registrationStatusFilter === value
                    ? `z-10 border-slate-400 border-b-transparent bg-[#CBD5E1] ${statusTabColors[value]}`
                    : 'border-slate-300 bg-[#F1F5F9] text-slate-500 hover:bg-slate-200 hover:text-slate-900'
                }`}
              >
                <span className="flex items-center justify-center gap-2">
                  <span>{label}</span>
                  {isPendingTab && (
                    <span aria-hidden="true" className={`inline-flex h-4 min-w-4 items-center justify-center rounded-full px-0.5 text-[8px] font-bold leading-none ${
                      statusCount > 0 ? 'bg-orange-500 text-white shadow-sm' : 'bg-slate-200 text-slate-600'
                    }`}>
                      {statusCount > 9 ? '9+' : statusCount}
                    </span>
                  )}
                </span>
              </button>
              );
            })}
          </div>
        </div>
        <div className="overflow-hidden rounded-b-xl rounded-tr-xl border-x border-b border-slate-200 bg-white shadow-sm">
        <div className="w-full overflow-hidden">
          <table aria-label="User registrations" className="user-registration-table w-full table-fixed border-collapse text-left text-[11px]">
            <colgroup>
              <col style={{ width: 'calc((100% - 224px) * 0.14)' }} />
              <col style={{ width: 'calc((100% - 224px) * 0.20)' }} />
              <col style={{ width: 'calc((100% - 224px) * 0.11)' }} />
              <col style={{ width: 'calc((100% - 224px) * 0.21)' }} />
              <col style={{ width: 'calc((100% - 224px) * 0.20)' }} />
              <col style={{ width: 'calc((100% - 224px) * 0.14)' }} />
              <col className="user-registration-status-column" />
              <col className="user-registration-status-column" />
              <col className="user-registration-action-column" />
            </colgroup>
            <thead>
              <tr className="admin-registration-table-header whitespace-nowrap border border-slate-400 bg-[#CBD5E1] text-[9px] font-bold uppercase tracking-wide text-slate-700 xl:text-[10px]">
                <th className="px-2 py-2.5">Username</th>
                <th className="px-2 py-2.5">Email address</th>
                <th className="px-2 py-2.5">Password</th>
                <th className="px-2 py-2.5">Company</th>
                <th className="px-2 py-2.5">Full name</th>
                <th className="px-2 py-2.5 text-center">Mobile number</th>
                <th className="px-1 py-2.5 text-center">Status</th>
                <th className="px-1 py-2.5 text-center">Email Status</th>
                <th className="px-1 py-2.5 text-center">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {paginatedUsers.length === 0 ? (
                <tr>
                  <td colSpan={9} className="align-middle text-center text-slate-500" style={{ height: MINIMUM_VISIBLE_ROWS * USER_ROW_HEIGHT }}>
                    <UsersRound className="w-6 h-6 mx-auto mb-2 text-slate-300" />
                    {loadError || (users.length ? 'No users match the selected filters.' : 'No company users found.')}
                  </td>
                </tr>
              ) : <>
                {paginatedUsers.map((user, index) => {
                  const resolvedEmailStatus = user.email_status || (['DONE', 'REJECTED'].includes(user.status) ? 'READY' : 'NOT_READY');
                  const canResendEmail = ['DONE', 'REJECTED'].includes(user.status) && resolvedEmailStatus !== 'SENDING';
                  return (
                <tr key={user.id} className={`transition-colors hover:bg-slate-100/70 ${index % 2 === 0 ? 'bg-white' : 'bg-slate-100/70'}`}>
                  <td className="px-2 py-2 font-semibold text-slate-900"><CopyableValue value={user.username} label="Username" /></td>
                  <td className="px-2 py-2 text-slate-700"><CopyableValue value={user.email} label="Email address" /></td>
                  <td className="px-2 py-2 font-mono text-[10px] text-slate-700"><CopyableValue value={user.password || 'Unavailable'} label="Password" /></td>
                  <td className="px-2 py-2 text-slate-700"><CopyableValue value={user.company_name.toUpperCase()} label="Company name" /></td>
                  <td className="px-2 py-2 text-slate-700"><CopyableValue value={user.full_name} label="Full name" /></td>
                  <td className="px-2 py-2 text-center text-slate-700"><CopyableValue value={user.mobile_number} label="Mobile number" /></td>
                  <td className="px-1 py-2 text-center">
                    <select
                      value={user.status || 'PENDING'}
                      onChange={(event) => void changeStatus(user, event.target.value as ExternalUserAccess['status'])}
                      disabled={savingKeys.has(`${user.id}-status`)}
                      title={user.status === 'REJECTED' ? 'Reopen this User Registration independently from the company queue.' : undefined}
                      className={`h-6 w-20 rounded-md border px-1 text-[9px] font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-wait disabled:opacity-60 ${statusSelectClasses[user.status || 'PENDING']}`}
                      aria-label={`Status for ${user.username}`}
                    >
                      {statuses.map((status) => <option key={status} value={status}>{status}</option>)}
                    </select>
                  </td>
                  <td className="px-1 py-2 text-center">
                    <div className={`mx-auto flex h-6 w-20 items-center justify-center rounded-md border text-center text-[9px] font-semibold ${emailStatusClasses(resolvedEmailStatus)}`}>
                      <CopyableValue value={emailStatusLabel(resolvedEmailStatus)} label="Email status" className="w-full text-center" />
                    </div>
                  </td>
                  <td className="px-1 py-2 text-center">
                    <UserActionMenu
                      username={user.username}
                      canResend={canResendEmail}
                      loading={openingPreview === user.id}
                      onEdit={() => setEditingUser({ ...user })}
                      onResend={() => void openPreview(user)}
                    />
                  </td>
                </tr>
                  );
                })}
                {userSpacerHeight > 0 && (
                  <tr aria-hidden="true">
                    <td colSpan={9} className="p-0" style={{ height: userSpacerHeight }} />
                  </tr>
                )}
              </>}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-center border-t border-slate-200 bg-slate-50 px-4 py-3">
          <nav className="flex items-center gap-1" aria-label="User registration pagination">
            <button
              type="button"
              onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
              disabled={safeCurrentPage === 1}
              aria-label="Previous page"
              title="Previous page"
              className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-600 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <span aria-hidden="true">&lsaquo;</span>
            </button>
            {pageNumbers.map((page) => (
              <button
                key={page}
                type="button"
                onClick={() => setCurrentPage(page)}
                aria-current={safeCurrentPage === page ? 'page' : undefined}
                className={`h-8 min-w-8 rounded-md px-2 text-xs font-semibold ${safeCurrentPage === page ? 'bg-blue-600 text-white' : 'border border-slate-300 bg-white text-slate-600 hover:bg-slate-100'}`}
              >
                {page}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}
              disabled={safeCurrentPage === totalPages}
              aria-label="Next page"
              title="Next page"
              className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-600 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <span aria-hidden="true">&rsaquo;</span>
            </button>
          </nav>
        </div>
        </div>
      </div>

      {editingUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center overflow-hidden bg-slate-900/55 p-4 backdrop-blur-xs">
          <form onSubmit={saveUserDetails} role="dialog" aria-modal="true" aria-labelledby="edit-user-title" className="w-full max-w-2xl overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-5 py-3.5">
              <div>
                <h3 id="edit-user-title" className="font-bold text-slate-900">Edit User Access</h3>
                <p className="mt-0.5 text-xs text-slate-500">Changes are saved directly to the user access database.</p>
              </div>
              <button type="button" onClick={() => setEditingUser(null)} disabled={savingEdit} aria-label="Close edit user popup" className="rounded-lg p-1 text-slate-400 hover:text-slate-700 disabled:opacity-50"><X className="h-5 w-5" /></button>
            </div>
            <div className="grid grid-cols-1 gap-x-4 gap-y-3 p-5 sm:grid-cols-2">
              <label className="text-xs font-semibold text-slate-700">Username
                <input autoFocus required value={editingUser.username} onChange={(event) => changeEditField('username', event.target.value)} className="mt-1.5 h-9 w-full rounded-lg border border-slate-300 px-3 font-normal focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </label>
              <label className="text-xs font-semibold text-slate-700">Email address
                <input type="email" required value={editingUser.email} onChange={(event) => changeEditField('email', event.target.value)} className="mt-1.5 h-9 w-full rounded-lg border border-slate-300 px-3 font-normal focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </label>
              <label className="text-xs font-semibold text-slate-700">Password
                <input required value={editingUser.password} onChange={(event) => changeEditField('password', event.target.value)} className="mt-1.5 h-9 w-full rounded-lg border border-slate-300 px-3 font-mono font-normal focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </label>
              <label className="text-xs font-semibold text-slate-700">Company
                <input value={editingUser.company_name} onChange={(event) => changeEditField('company_name', event.target.value.toUpperCase())} className="mt-1.5 h-9 w-full rounded-lg border border-slate-300 px-3 font-normal uppercase focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </label>
              <label className="text-xs font-semibold text-slate-700">Full name
                <input required value={editingUser.full_name} onChange={(event) => changeEditField('full_name', event.target.value)} className="mt-1.5 h-9 w-full rounded-lg border border-slate-300 px-3 font-normal focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </label>
              <label className="text-xs font-semibold text-slate-700">Mobile number
                <input type="tel" required value={editingUser.mobile_number} onChange={(event) => changeEditField('mobile_number', event.target.value)} className="mt-1.5 h-9 w-full rounded-lg border border-slate-300 px-3 font-normal focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </label>
              <label className="text-xs font-semibold text-slate-700">Registration status
                <select value={editingUser.status} title={editingUser.status === 'REJECTED' ? 'Reopen this User Registration independently from the company queue.' : undefined} onChange={(event) => changeEditField('status', event.target.value)} className={`mt-1.5 h-9 w-full rounded-lg border px-3 font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500 ${statusSelectClasses[editingUser.status]}`}>
                  {statuses.map((status) => <option key={status} value={status} disabled={status === 'REJECTED' && editingUser.status !== 'REJECTED'}>{status}</option>)}
                </select>
              </label>
              {['DONE', 'REJECTED'].includes(editingUser.status) && (
                <label className="text-xs font-semibold text-slate-700">Email status
                  <select
                    value={editingUser.email_status === 'SENT' ? 'DONE' : 'READY'}
                    onChange={(event) => changeEditField('email_status', event.target.value === 'DONE' ? 'SENT' : 'READY')}
                    className={`mt-1.5 h-9 w-full rounded-lg border px-3 font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500 ${emailStatusClasses(editingUser.email_status === 'SENT' ? 'SENT' : 'READY')}`}
                  >
                    <option value="READY">READY</option>
                    <option value="DONE">DONE</option>
                  </select>
                </label>
              )}
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-3.5">
              <button type="button" onClick={() => setEditingUser(null)} disabled={savingEdit} className="rounded-lg px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-200 disabled:opacity-50">Cancel</button>
              <button type="submit" disabled={savingEdit} className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-xs font-bold text-white hover:bg-blue-700 disabled:cursor-wait disabled:opacity-60"><Save className="h-4 w-4" />{savingEdit ? 'Saving...' : 'Save Changes'}</button>
            </div>
          </form>
        </div>
      )}

      {codeUser && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/55 p-4 backdrop-blur-xs">
        <div role="dialog" aria-modal="true" aria-labelledby="email-code-title" className="w-full max-w-lg rounded-2xl border border-slate-100 bg-white p-5 shadow-2xl">
          <div className="flex items-start justify-between gap-3"><div><h3 id="email-code-title" className="text-base font-semibold text-slate-900">{codeAction === 'REJECT' ? 'Reject User Registration' : 'Choose email template'}</h3><p className="mt-1 text-xs text-slate-500">Select an {codeUser.status === 'DONE' ? 'acceptance' : 'rejection'} code and port for {codeUser.email}.{codeAction === 'REJECT' ? ' The user will be rejected before the email preview opens.' : ''}</p></div><button type="button" onClick={() => setCodeUser(null)} aria-label="Close code selection" className="text-slate-400 hover:text-slate-700"><X className="h-5 w-5" /></button></div>
          <label className="mt-5 block text-xs font-semibold text-slate-700">Port and code
            <select autoFocus value={selectedTemplateId} onChange={(event) => setSelectedTemplateId(event.target.value)} className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-normal">
              <option value="__choose__" disabled>Choose a code...</option>
              {codePorts.map((port) => <optgroup key={port.id} label={port.display_name}>
                {codeTemplates.filter((template) => template.active && template.template_code && template.port_ids?.includes(port.id) && template.trigger_status === codeUser.status && isEmailTemplateForRegistration(template, 'COMPANY') && (codeAction === 'REJECT' || codeUser.status !== 'REJECTED' || !template.rejection_reason || template.rejection_reason === codeUser.rejection_reason)).map((template) => <option key={template.id} value={`${template.id}::${port.id}`}>{template.template_code} — {template.name}</option>)}
              </optgroup>)}
            </select>
          </label>
          <div className="mt-5 flex justify-end gap-2"><button type="button" onClick={() => setCodeUser(null)} className="rounded-lg px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100">Cancel</button><button type="button" onClick={() => void openSelectedPreview()} disabled={selectedTemplateId === '__choose__' || openingPreview === codeUser.id} className={`rounded-lg px-4 py-2 text-xs font-semibold text-white disabled:opacity-50 ${codeAction === 'REJECT' ? 'bg-rose-600 hover:bg-rose-700' : 'bg-blue-600 hover:bg-blue-700'}`}>{openingPreview === codeUser.id ? 'Loading...' : codeAction === 'REJECT' ? 'Reject & Preview Email' : 'Preview email'}</button></div>
        </div>
      </div>}

      {preview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/55 p-4 backdrop-blur-xs">
          <div role="dialog" aria-modal="true" aria-labelledby="email-preview-title" className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-5 py-4">
              <div><h3 id="email-preview-title" className="font-bold text-slate-900">Email Preview</h3><p className="mt-0.5 text-xs text-slate-500">{preview.templateCode ? `${preview.templateCode} — ` : ''}{preview.templateName}</p></div>
              <button type="button" onClick={() => setPreview(null)} disabled={sending} className="rounded-lg p-1 text-slate-400 hover:text-slate-700"><X className="h-5 w-5" /></button>
            </div>
            <div className="space-y-4 overflow-y-auto p-5">
              <label className="block text-xs font-semibold text-slate-700">To
                <input value={preview.recipient} readOnly className="mt-1.5 w-full rounded-lg border border-slate-200 bg-slate-100 px-3 py-2 font-normal text-slate-700" />
              </label>
              <label className="block text-xs font-semibold text-slate-700">Subject
                <input value={preview.subject} onChange={(event) => setPreview({ ...preview, subject: event.target.value })} className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 font-normal" />
              </label>
              <div className="text-xs font-semibold text-slate-700">Message
                <RichTextEmailEditor value={preview.body} onChange={(body) => setPreview((current) => current ? { ...current, body } : current)} minHeightClassName="min-h-64" />
              </div>
              {preview.attachments.length > 0 && (
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <div className="mb-2 text-xs font-semibold text-slate-700">Attachments</div>
                  <div className="space-y-1.5">
                    {preview.attachments.map((attachment) => (
                      <div key={attachment.path} className="flex items-center gap-2 text-xs text-slate-600">
                        <Download className="h-3.5 w-3.5 text-slate-400" />
                        <span className="min-w-0 flex-1 truncate">{attachment.name}</span>
                        <span className="text-slate-400">{(attachment.size / 1024 / 1024).toFixed(2)} MB</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-4">
              <button type="button" onClick={() => setPreview(null)} disabled={sending} className="rounded-lg px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-200">Cancel</button>
              <button type="button" onClick={() => void sendPreview()} disabled={sending} className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-xs font-bold text-white hover:bg-blue-700 disabled:opacity-60"><Mail className="h-4 w-4" />{sending ? 'Sending...' : 'Send Email'}</button>
            </div>
          </div>
        </div>
      )}
      {blockedUser && <CompanyRegistrationWarning user={blockedUser} onClose={() => setBlockedUser(null)} />}
    </div>
  );
}
