import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { RegistrationSubmission, RegistrationType, SubmissionStatus, Company, RejectionReason } from '../../types';
import {
  getSubmissions,
  getCompanies,
  getCompanyById,
  ensureSubmissionCompany,
  deleteSubmission,
  updateSubmissionStatusPersisted,
  rejectCompanySubmission,
  revertSubmissionToPending,
  subscribeToStorage,
  refreshProtectedStorage,
} from '../../services/storage';
import { getExternalUserAccess } from '../../services/auth';
import { EmailPreview, EmailTemplate, generateSubmissionEmailPreview, generateWelcomeEmailPreview, getEmailTemplateCatalog, sendSubmissionEmail, sendWelcomeEmail } from '../../services/email';
import { getCompanyExternalId } from '../../services/companyHelper';
import { generateRegistrationExcel } from '../../services/registrationUploads';
import { downloadRegistrationExcel, exportSubmissionsToExcel } from '../../services/excelExport';
import { RegistrationReference } from './RegistrationReference';
import { QueueCompanyName } from './QueueCompanyName';
import { assetCompanyBlockReason, COMPANY_REGISTRATION_REQUIRED } from '../../../shared/registration-eligibility';
import { CargoMoveIdBadge, StatusBadge } from '../common/Badge';
import { SubmissionDetailModal } from './SubmissionDetailModal';
import { AssignIdModal } from './AssignIdModal';
import { RichTextEmailEditor } from './RichTextEmailEditor';
import { PdfAttachmentIcon } from './PdfAttachmentIcon';
import {
  Search,
  Filter,
  Eye,
  AlertTriangle,
  Trash2,
  Key,
  MoreVertical,
  Mail,
  X,
  RotateCcw,
  Info,
  CircleCheck,
  CircleX,
} from 'lucide-react';
import { notifyError, notifySuccess, notifyWarning, summarizeError } from '../common/notifications';
import { formatAdminDate } from '../../utils/date';
import { isEmailTemplateForRegistration } from '../../utils/registrationEmailTemplates';

interface SubmissionsListProps {
  status: SubmissionStatus;
  initialType?: RegistrationType;
}

type IdFilter = 'ALL' | 'MISSING' | 'WITH_ID';
type SubmissionSort = 'SUBMITTED_ASC' | 'SUBMITTED_DESC' | 'COMPANY_ASC' | 'COMPANY_DESC';

interface ActionMenuPosition {
  id: string;
  top: number;
  left: number;
  anchorTop: number;
  anchorBottom: number;
  anchorRight: number;
}

interface BulkMenuPosition {
  top: number;
  left: number;
}

interface CodeSelection {
  submission: RegistrationSubmission;
  status: 'DONE' | 'REJECTED';
  portId: string;
  portName: string;
  templates: EmailTemplate[];
  alreadyUpdated: boolean;
  adminNotes?: string;
  linkedUserId?: string;
}

const ACTION_MENU_GAP = 4;
const VIEWPORT_EDGE_PADDING = 8;
const PAGE_SIZE_OPTIONS = [20, 30, 50];
const MINIMUM_VISIBLE_ROWS = 4;
const SUBMISSION_ROW_HEIGHT = 56;

function defaultSortForStatus(status: SubmissionStatus): SubmissionSort {
  return status === 'PENDING' ? 'SUBMITTED_ASC' : 'SUBMITTED_DESC';
}

function submissionSortTime(submission: RegistrationSubmission, status: SubmissionStatus): number {
  if (status === 'REJECTED') {
    return Date.parse(submission.reviewed_at || submission.submitted_at);
  }
  if (status === 'DONE') {
    return Date.parse(submission.exported_at || submission.reviewed_at || submission.submitted_at);
  }
  return Date.parse(submission.submitted_at);
}

function getVisiblePageNumbers(currentPage: number, totalPages: number): number[] {
  const visibleCount = Math.min(5, totalPages);
  const start = Math.min(
    Math.max(1, currentPage - Math.floor(visibleCount / 2)),
    totalPages - visibleCount + 1,
  );
  return Array.from({ length: visibleCount }, (_, index) => start + index);
}

const statusTitles: Record<SubmissionStatus, string> = {
  PENDING: 'Pending Registration Submissions',
  DONE: 'Closed / Done Registration Submissions',
  REJECTED: 'Rejected Registration Submissions',
};

const statusDescriptions: Record<SubmissionStatus, string> = {
  PENDING: 'Review new applications and check their details before completing registration.',
  DONE: 'View completed registrations, check application details, and export records to Excel.',
  REJECTED: 'View rejected applications, check the reasons, and return them to pending for another review if needed.',
};

const statusTitleColors: Record<SubmissionStatus, string> = {
  PENDING: 'text-amber-600',
  DONE: 'text-emerald-700',
  REJECTED: 'text-red-600',
};

const registrationTypeTabs: Array<{ value: RegistrationType; label: string }> = [
  { value: 'COMPANY', label: 'Company' },
  { value: 'DRIVER', label: 'Driver' },
  { value: 'TRAILER', label: 'Trailer' },
  { value: 'VEHICLE', label: 'Vehicle' },
];

const MANUAL_REGISTER_TOOLTIP = 'Downloads the company registration Excel for manual processing. Selected submissions are moved to Closed/Done. No email is sent.';
const REGISTER_AND_EMAIL_TOOLTIP = 'Uploads the selected registrations to CargoMove for processing. After verification, you can preview and send the completion email.';

function QueuePrimaryAction({ tooltip, children }: { tooltip?: string; children: React.ReactNode }) {
  const [tooltipPosition, setTooltipPosition] = useState<{ top: number; left: number } | null>(null);
  const containerRef = React.useRef<HTMLDivElement | null>(null);

  const showTooltip = () => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const width = 320;
    setTooltipPosition({
      top: rect.top - ACTION_MENU_GAP,
      left: Math.max(VIEWPORT_EDGE_PADDING, Math.min(rect.right - width, window.innerWidth - width - VIEWPORT_EDGE_PADDING)),
    });
  };

  return (
    <div
      ref={containerRef}
      className="relative flex min-w-0 flex-1"
      onMouseEnter={tooltip ? showTooltip : undefined}
      onMouseLeave={tooltip ? () => setTooltipPosition(null) : undefined}
      onFocusCapture={tooltip ? showTooltip : undefined}
      onBlurCapture={tooltip ? (event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setTooltipPosition(null);
      } : undefined}
    >
      {children}
      {tooltip && tooltipPosition && createPortal(
        <div
          id="queue-primary-action-tooltip"
          role="tooltip"
          className="pointer-events-none fixed z-[80] w-80 -translate-y-full rounded-lg bg-slate-900 px-3 py-2 text-xs leading-5 text-white shadow-xl"
          style={{ top: tooltipPosition.top, left: tooltipPosition.left }}
        >
          {tooltip}
        </div>,
        document.body,
      )}
    </div>
  );
}

function QueueMoreActions({ disabled, children }: {
  disabled: boolean;
  children: React.ReactNode;
}) {
  const [position, setPosition] = useState<BulkMenuPosition | null>(null);
  const buttonRef = React.useRef<HTMLButtonElement | null>(null);
  const menuRef = React.useRef<HTMLDivElement | null>(null);
  const menuId = React.useId();
  const close = () => setPosition(null);
  const isInside = (target: EventTarget | null) => target instanceof Node
    && (buttonRef.current?.contains(target) || menuRef.current?.contains(target));
  const supportsHover = () => window.matchMedia('(hover: hover) and (pointer: fine)').matches;

  const open = () => {
    if (disabled) return;
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;
    const width = 256;
    setPosition({
      top: Math.min(rect.bottom + ACTION_MENU_GAP, window.innerHeight - VIEWPORT_EDGE_PADDING - 160),
      left: Math.max(VIEWPORT_EDGE_PADDING, Math.min(rect.right - width, window.innerWidth - width - VIEWPORT_EDGE_PADDING)),
    });
  };

  const leave = (event: React.PointerEvent<HTMLElement>) => {
    if (event.pointerType === 'mouse' && supportsHover() && !isInside(event.relatedTarget)) close();
  };

  React.useEffect(() => {
    if (disabled) close();
  }, [disabled]);

  React.useEffect(() => {
    if (!position) return;
    const outside = (event: PointerEvent) => { if (!isInside(event.target)) close(); };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        close();
        buttonRef.current?.focus();
      }
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    window.addEventListener('resize', close);
    window.addEventListener('scroll', close, true);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', close, true);
    };
  }, [position]);

  return <>
    <button
      ref={buttonRef}
      type="button"
      aria-label="More registration actions"
      aria-haspopup="menu"
      aria-controls={position ? menuId : undefined}
      aria-expanded={!!position}
      onPointerEnter={(event) => { if (event.pointerType === 'mouse' && supportsHover()) open(); }}
      onPointerLeave={leave}
      onClick={(event) => {
        if (event.detail > 0 && supportsHover()) open();
        else if (position) close();
        else open();
      }}
      onBlur={(event) => { if (!isInside(event.relatedTarget)) close(); }}
      disabled={disabled}
      className="h-9 rounded-r-lg border-l border-emerald-500 bg-emerald-600 px-2 text-white hover:bg-emerald-700 disabled:opacity-40"
    ><MoreVertical className="h-4 w-4" /></button>
    {position && createPortal(
      <div
        ref={menuRef}
        className="fixed z-[61] w-64"
        style={{ top: position.top - ACTION_MENU_GAP, left: position.left, paddingTop: ACTION_MENU_GAP }}
        onPointerLeave={leave}
        onBlur={(event) => { if (!isInside(event.relatedTarget)) close(); }}
        onClick={close}
      >
        {/* Include the gap in the hover area so moving down into an option keeps it open. */}
        <div id={menuId} role="menu" className="rounded-lg border border-slate-200 bg-white p-1 shadow-xl">
          {children}
        </div>
      </div>,
      document.body,
    )}
  </>;
}

export function SubmissionsList({ status, initialType = 'COMPANY' }: SubmissionsListProps) {
  // Read browser storage once on entry, then only when the data actually changes.
  const [{ submissions, companies }, setSnapshot] = useState(() => ({
    submissions: getSubmissions(),
    companies: getCompanies(),
  }));
  const companiesById = React.useMemo(() => new Map(companies.map(company => [company.id, company])), [companies]);
  const companyRegistrationStatuses = React.useMemo(() => {
    const latest = new Map<string, RegistrationSubmission>();
    for (const submission of submissions) {
      if (submission.registration_type !== 'COMPANY') continue;
      const previous = latest.get(submission.company_id);
      const time = Date.parse(submission.submitted_at) || 0;
      const previousTime = previous ? Date.parse(previous.submitted_at) || 0 : 0;
      if (!previous || time > previousTime || (time === previousTime && submission.id > previous.id)) {
        latest.set(submission.company_id, submission);
      }
    }
    return new Map(companies.map(company => [
      company.id, latest.get(company.id)?.status || company.registration_status || 'PENDING',
    ]));
  }, [companies, submissions]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [exporting, setExporting] = useState(false);
  const [uploadProgress, setUploadProgress] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [typeFilter, setTypeFilter] = useState<RegistrationType | 'ALL'>(initialType);
  const [portFilter, setPortFilter] = useState<string>('ALL');
  const [idFilter, setIdFilter] = useState<IdFilter>('ALL');
  const [sortBy, setSortBy] = useState<SubmissionSort>(() => defaultSortForStatus(status));
  const [pageSize, setPageSize] = useState(20);
  const [currentPage, setCurrentPage] = useState(1);
  const [openActionMenu, setOpenActionMenu] = useState<ActionMenuPosition | null>(null);
  const actionMenuRef = React.useRef<HTMLDivElement | null>(null);

  // Modals
  const [activeSubmission, setActiveSubmission] = useState<RegistrationSubmission | null>(null);
  const [assignIdCompany, setAssignIdCompany] = useState<Company | null>(null);
  const [revertConfirmation, setRevertConfirmation] = useState<RegistrationSubmission | null>(null);
  const [reverting, setReverting] = useState(false);
  const [codeSelection, setCodeSelection] = useState<CodeSelection | null>(null);
  const [selectedCodeId, setSelectedCodeId] = useState('');
  const [savingCode, setSavingCode] = useState(false);
  const [submissionEmailPreviews, setSubmissionEmailPreviews] = useState<EmailPreview[]>([]);
  const [submissionEmailPreviewIndex, setSubmissionEmailPreviewIndex] = useState(0);
  const [emailSendMode, setEmailSendMode] = useState<'SUBMISSION' | 'USER'>('SUBMISSION');
  const [sendingSubmissionEmail, setSendingSubmissionEmail] = useState(false);
  const [batchCodes, setBatchCodes] = useState<Array<CodeSelection & { templateId: string }>>([]);
  const [batchCodePage, setBatchCodePage] = useState(0);

  const refreshList = () => {
    setSnapshot({ submissions: getSubmissions(), companies: getCompanies() });
  };

  React.useEffect(() => subscribeToStorage(refreshList), []);

  React.useEffect(() => {
    setSelectedIds([]);
    setOpenActionMenu(null);
    setActiveSubmission(null);
    setAssignIdCompany(null);
    setIdFilter('ALL');
    setCodeSelection(null);
    setSubmissionEmailPreviews([]);
    setSubmissionEmailPreviewIndex(0);
    setEmailSendMode('SUBMISSION');
    setSortBy(defaultSortForStatus(status));
    setCurrentPage(1);
  }, [status]);

  React.useEffect(() => {
    setTypeFilter(initialType);
  }, [initialType]);

  React.useEffect(() => {
    setCurrentPage(1);
    setOpenActionMenu(null);
  }, [searchTerm, typeFilter, portFilter, idFilter, sortBy, pageSize]);

  React.useEffect(() => {
    setSelectedIds([]);
  }, [status, typeFilter]);

  // Keep the action list inside the viewport. In particular, rows near the
  // bottom edge need the list to open above the action button.
  React.useLayoutEffect(() => {
    if (!openActionMenu || !actionMenuRef.current) return;

    const menuRect = actionMenuRef.current.getBoundingClientRect();
    const belowTop = openActionMenu.anchorBottom;
    const fitsBelow = belowTop + menuRect.height <= window.innerHeight - VIEWPORT_EDGE_PADDING;
    const top = fitsBelow
      ? belowTop
      : Math.max(VIEWPORT_EDGE_PADDING, openActionMenu.anchorTop - menuRect.height);
    const left = Math.min(
      Math.max(VIEWPORT_EDGE_PADDING, openActionMenu.anchorRight - menuRect.width),
      Math.max(VIEWPORT_EDGE_PADDING, window.innerWidth - menuRect.width - VIEWPORT_EDGE_PADDING),
    );

    if (top !== openActionMenu.top || left !== openActionMenu.left) {
      setOpenActionMenu((current) => current ? { ...current, top, left } : null);
    }
  }, [
    openActionMenu?.id,
    openActionMenu?.anchorTop,
    openActionMenu?.anchorBottom,
    openActionMenu?.anchorRight,
  ]);

  React.useEffect(() => {
    if (!openActionMenu) return;

    const closeActionMenu = () => setOpenActionMenu(null);
    window.addEventListener('resize', closeActionMenu);
    window.addEventListener('scroll', closeActionMenu, true);
    return () => {
      window.removeEventListener('resize', closeActionMenu);
      window.removeEventListener('scroll', closeActionMenu, true);
    };
  }, [openActionMenu?.id]);

  const handleSelectAll = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.checked) {
      setSelectedIds(filteredSubmissions.map((s) => s.id));
    } else {
      setSelectedIds([]);
    }
  };

  const handleToggleSelect = (id: string) => {
    setSelectedIds((current) => current.includes(id)
      ? current.filter((item) => item !== id)
      : [...current, id]);
  };

  const handleCopyQueueValue = async (value: string, label: string) => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
      } else {
        const copyInput = document.createElement('textarea');
        copyInput.value = value;
        copyInput.style.position = 'fixed';
        copyInput.style.opacity = '0';
        document.body.appendChild(copyInput);
        copyInput.select();
        const copied = document.execCommand('copy');
        copyInput.remove();
        if (!copied) throw new Error('Copy command failed.');
      }
      notifySuccess(`${label} copied.`);
    } catch {
      notifyError(`Unable to copy ${label.toLowerCase()}.`);
    }
  };

  const filteredSubmissions = React.useMemo(() => submissions.filter((sub) => {
    const term = searchTerm.toLowerCase();
    const matchesSearch =
      !term ||
      sub.reference_no.toLowerCase().includes(term) ||
      sub.company_name.toLowerCase().includes(term) ||
      sub.company_reg_no.toLowerCase().includes(term);

    const matchesType = typeFilter === 'ALL' || sub.registration_type === typeFilter;
    const matchesStatus = sub.status === status;
    const matchesPort = portFilter === 'ALL' || sub.port_location === portFilter;

    if (!matchesSearch || !matchesType || !matchesStatus || !matchesPort) return false;
    if (idFilter === 'ALL') return true;

    const company = companiesById.get(sub.company_id);
    const idInfo = getCompanyExternalId(company || { company_type: sub.company_type });
    const matchesId =
      (idFilter === 'MISSING' && !idInfo.has_required_id) ||
      (idFilter === 'WITH_ID' && idInfo.has_required_id);

    return matchesId;
  }), [submissions, companiesById, searchTerm, typeFilter, status, portFilter, idFilter]);
  const pendingCounts = React.useMemo(() => {
    const counts = new Map<RegistrationType, number>();
    for (const submission of submissions) {
      if (submission.status === 'PENDING') counts.set(submission.registration_type, (counts.get(submission.registration_type) || 0) + 1);
    }
    return counts;
  }, [submissions]);
  const sortedSubmissions = React.useMemo(() => [...filteredSubmissions].sort((left, right) => {
    if (sortBy === 'COMPANY_ASC') return left.company_name.localeCompare(right.company_name);
    if (sortBy === 'COMPANY_DESC') return right.company_name.localeCompare(left.company_name);
    const dateDifference = submissionSortTime(left, status) - submissionSortTime(right, status);
    return sortBy === 'SUBMITTED_ASC' ? dateDifference : -dateDifference;
  }), [filteredSubmissions, sortBy, status]);
  const totalPages = Math.max(1, Math.ceil(sortedSubmissions.length / pageSize));
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const pageStart = (safeCurrentPage - 1) * pageSize;
  const paginatedSubmissions = sortedSubmissions.slice(pageStart, pageStart + pageSize);
  const submissionSpacerHeight = Math.max(0, MINIMUM_VISIBLE_ROWS - paginatedSubmissions.length) * SUBMISSION_ROW_HEIGHT;
  const pageNumbers = getVisiblePageNumbers(safeCurrentPage, totalPages);

  React.useEffect(() => {
    if (currentPage > totalPages) setCurrentPage(totalPages);
  }, [currentPage, totalPages]);

  const selectedSubmissions = React.useMemo(() => {
    const selected = new Set(selectedIds);
    return submissions.filter(submission => selected.has(submission.id));
  }, [submissions, selectedIds]);
  const companyManualRegistration = status === 'PENDING' && (typeFilter === 'COMPANY'
    || (selectedSubmissions.length > 0 && selectedSubmissions.every((submission) => submission.registration_type === 'COMPANY')));
  const primaryActionTooltip = companyManualRegistration
    ? MANUAL_REGISTER_TOOLTIP
    : status === 'PENDING' ? REGISTER_AND_EMAIL_TOOLTIP : undefined;

  const handleCompanyManualRegistration = async (selectedSubs: RegistrationSubmission[]) => {
    const result = exportSubmissionsToExcel(selectedSubs, { downloadOnly: true });
    if (!result.success) {
      notifyError(result.error || 'Unable to export the company registration workbook.');
      return;
    }
    const completedIds: string[] = [];
    const failures: string[] = [];
    for (const submission of selectedSubs) {
      try {
        await updateSubmissionStatusPersisted(submission.id, 'DONE');
        completedIds.push(submission.id);
      } catch (error) {
        failures.push(`${submission.reference_no}: ${error instanceof Error ? error.message : 'Unable to mark as Closed/Done.'}`);
      }
    }
    if (completedIds.length) {
      setSelectedIds((current) => current.filter((id) => !completedIds.includes(id)));
      refreshList();
      notifySuccess(`${completedIds.length} company registration(s) exported for manual registration and moved to Closed/Done. No email was sent.`);
    }
    if (failures.length) notifyError(failures.join('\n'));
  };

  const handleBulkRevertToPending = async () => {
    if (status === 'REJECTED' && selectedSubmissions.some((submission) => submission.registration_type === 'COMPANY')) {
      notifyWarning('Revert rejected company registrations one at a time to choose whether the linked User Registration should also return to Pending.');
      return;
    }
    setReverting(true);
    const revertedIds: string[] = [];
    const failures: string[] = [];
    for (const submission of selectedSubmissions) {
      try {
        await revertSubmissionToPending(submission.id);
        revertedIds.push(submission.id);
      } catch (error) {
        failures.push(`${submission.reference_no}: ${error instanceof Error ? error.message : 'Unable to revert.'}`);
      }
    }
    setReverting(false);
    if (revertedIds.length) {
      setSelectedIds((current) => current.filter((id) => !revertedIds.includes(id)));
      refreshList();
      if (!failures.length) notifySuccess(`${revertedIds.length} registration(s) reverted to Pending.`);
    }
    if (failures.length) notifyError(failures.join('\n'));
  };

  const handleBulkMarkDone = async () => {
    const pendingSubmissions = selectedSubmissions.filter((submission) => submission.status === 'PENDING');
    if (!pendingSubmissions.length) {
      notifyWarning('Select at least one Pending registration.');
      return;
    }
    setReverting(true);
    const completedIds: string[] = [];
    const failures: string[] = [];
    for (const submission of pendingSubmissions) {
      try {
        await updateSubmissionStatusPersisted(submission.id, 'DONE');
        completedIds.push(submission.id);
      } catch (error) {
        failures.push(`${submission.reference_no}: ${error instanceof Error ? error.message : 'Unable to mark as Done.'}`);
      }
    }
    setReverting(false);
    if (completedIds.length) {
      setSelectedIds((current) => current.filter((id) => !completedIds.includes(id)));
      refreshList();
      if (!failures.length) notifySuccess(`${completedIds.length} registration(s) marked Closed/Done. No email was sent.`);
    }
    if (failures.length) notifyError(failures.join('\n'));
  };

  const handleBulkExport = async () => {
    const selectedSubs = submissions.filter((s) => selectedIds.includes(s.id));
    if (selectedSubs.length === 0) {
      const message = 'Please select at least one submission to export.';
      notifyWarning(message);
      return;
    }

    if (status === 'PENDING' && selectedSubs.every((submission) => submission.registration_type === 'COMPANY')) {
      setExporting(true);
      try {
        await handleCompanyManualRegistration(selectedSubs);
      } catch (error) {
        notifyError(error instanceof Error ? error.message : 'Unable to export company registrations.');
      } finally {
        setExporting(false);
      }
      return;
    }

    if (status !== 'PENDING') {
      try {
        const results = downloadRegistrationExcel(selectedSubs);
        const failures = results.filter((result) => !result.success);
        if (failures.length) {
          notifyError(failures.map((result) => result.error || 'Excel export failed.').join('\n'));
        } else {
          notifySuccess(`${selectedSubs.length} registration(s) exported to Excel. Registration statuses unchanged.`);
        }
      } catch (error) {
        notifyError(error instanceof Error ? error.message : 'Unable to export registrations.');
      }
      return;
    }

    setExporting(true);
    const res = await generateRegistrationExcel(selectedSubs, setUploadProgress);
    setExporting(false);
    refreshList();
    if (res.downloaded.length) notifySuccess(`${res.downloaded.length} Company registration(s) downloaded. Complete their manual registration using the Register action.`);
    const summary = `${res.verified.length} successful, ${res.incompleteCount} incomplete.`;
    if (res.incompleteCount) notifyWarning(`${summary}\n${res.error.replaceAll(COMPANY_REGISTRATION_REQUIRED, 'Company must be registered.')}`);
    else if (res.verified.length) notifySuccess(summary);
    if (res.verified.length) {
      refreshList();
      setSelectedIds([]);
      const assets = res.verified.filter((submission) => submission.registration_type !== 'COMPANY');
      if (assets.length) void openSubmissionBatchEmailPreview(assets, 'DONE');
    }
  };

  const handleOpenAssignIdForSub = (sub: RegistrationSubmission) => {
    const company = ensureSubmissionCompany(sub.id);
    if (company) {
      setAssignIdCompany(company);
    } else {
      notifyWarning('This submission does not contain enough company information to create a master record.');
    }
  };

  const applyCodeAndPreview = async (selection: CodeSelection, template: EmailTemplate) => {
    setSavingCode(true);
    try {
      if (!selection.alreadyUpdated) {
        if (selection.submission.registration_type === 'COMPANY' && selection.status === 'REJECTED') {
          const reason: RejectionReason = template.rejection_reason || 'OTHER';
          await rejectCompanySubmission(selection.submission.id, reason, template.name);
        } else {
          await updateSubmissionStatusPersisted(selection.submission.id, selection.status, selection.adminNotes);
        }
      }
      refreshList();
      const userAcceptance = selection.submission.registration_type === 'COMPANY' && selection.status === 'DONE';
      if (userAcceptance && !selection.linkedUserId) throw new Error('The approved User Registration could not be found.');
      const generated = userAcceptance
        ? await generateWelcomeEmailPreview(selection.linkedUserId!, template.id, selection.portId)
        : await generateSubmissionEmailPreview(selection.submission.id, selection.status, template.id, selection.portId);
      setSubmissionEmailPreviews([generated]);
      setSubmissionEmailPreviewIndex(0);
      setEmailSendMode(userAcceptance ? 'USER' : 'SUBMISSION');
      setCodeSelection(null);
      setActiveSubmission(null);
    } catch (error) {
      refreshList();
      notifyError(error instanceof Error ? error.message : 'Unable to prepare the registration email.');
    } finally {
      setSavingCode(false);
    }
  };

  const startCodeFlow = async (
    submission: RegistrationSubmission,
    nextStatus: 'DONE' | 'REJECTED',
    options: { alreadyUpdated?: boolean; adminNotes?: string } = {},
  ) => {
    setOpenActionMenu(null);
    if (nextStatus === 'DONE' && submission.registration_type === 'COMPANY' && !options.alreadyUpdated) {
      const company = submission.company_id ? getCompanyById(submission.company_id) : undefined;
      const idInfo = getCompanyExternalId({
        company_type: company?.company_type || submission.company_type || submission.data.company?.company_type,
        haulier_id: company?.haulier_id || submission.data.company?.haulier_id,
        forwarding_agent_id: company?.forwarding_agent_id || submission.data.company?.forwarding_agent_id,
      });
      if (!idInfo.has_required_id) {
        notifyError(`Company registration is missing required ${idInfo.required_id_type}. Assign its CargoMove ID before registering.`);
        return;
      }
    }
    if (nextStatus === 'DONE' && submission.registration_type !== 'COMPANY'
      && submission.status === 'PENDING' && submission.cargomove_upload?.state === 'SUCCESS') {
      options = { ...options, alreadyUpdated: true };
    }
    setSavingCode(true);
    try {
      let linkedUserId: string | undefined;
      if (submission.registration_type === 'COMPANY' && nextStatus === 'DONE') {
        if (!options.alreadyUpdated) {
          await updateSubmissionStatusPersisted(submission.id, 'DONE', options.adminNotes);
          refreshList();
          setActiveSubmission(null);
        }
        let linkedUser;
        try {
          linkedUser = (await getExternalUserAccess()).find((user) => user.company_id === submission.company_id);
        } catch (error) {
          if (options.alreadyUpdated) throw error;
          notifyWarning('Company registered. Unable to check User Registration right now; preview the email after confirming it is done.');
          return;
        }
        if (linkedUser?.status !== 'DONE') {
          if (options.alreadyUpdated) {
            notifyWarning('Complete the linked User Registration before previewing or sending the company acceptance email.');
          } else {
            notifySuccess('Company registered. Complete the User Registration next.');
          }
          return;
        }
        linkedUserId = linkedUser.id;
        options = { ...options, alreadyUpdated: true };
      }
      const catalog = await getEmailTemplateCatalog();
      const portId = ['jh-pg-ics', 'jh-pg-depot'].includes(submission.port_id) ? 'johor-port' : submission.port_id;
      const port = catalog.ports.find((item) => item.id === portId);
      if (!portId || !port) throw new Error('This registration has no configured port. Assign its port before selecting an email code.');
      const templates = catalog.templates
        .filter((template) => template.active && template.template_code && template.trigger_status === nextStatus && template.port_ids?.includes(portId) && isEmailTemplateForRegistration(template, submission.registration_type))
        .sort((left, right) => (left.template_code || '').localeCompare(right.template_code || ''));
      if (!templates.length) throw new Error(`No active ${nextStatus === 'DONE' ? 'acceptance' : 'rejection'} code is assigned to ${port.display_name}. Assign a code in Registration Templates first.`);
      const selection: CodeSelection = {
        submission,
        status: nextStatus,
        portId,
        portName: port.display_name,
        templates,
        alreadyUpdated: !!options.alreadyUpdated,
        adminNotes: options.adminNotes,
        linkedUserId,
      };
      if (templates.length === 1) {
        await applyCodeAndPreview(selection, templates[0]);
      } else {
        setSelectedCodeId('');
        setCodeSelection(selection);
      }
    } catch (error) {
      notifyError(error instanceof Error ? error.message : 'Unable to load the email codes for this port.');
    } finally {
      setSavingCode(false);
    }
  };

  const openSubmissionBatchEmailPreview = async (selected: RegistrationSubmission[], outcome: 'DONE' | 'REJECTED') => {
    setSavingCode(true);
    try {
      const catalog = await getEmailTemplateCatalog();
      const choices: Array<CodeSelection & { templateId: string }> = [];
      const incomplete: string[] = [];
      for (const submission of selected) {
        const portId = ['jh-pg-ics', 'jh-pg-depot'].includes(submission.port_id) ? 'johor-port' : submission.port_id;
        const templates = catalog.templates.filter((template) => template.active && template.template_code && template.trigger_status === outcome && template.port_ids?.includes(portId) && isEmailTemplateForRegistration(template, submission.registration_type));
        if (!templates.length) { incomplete.push(`${submission.reference_no}: no ${outcome === 'DONE' ? 'acceptance' : 'rejection'} code assigned to this port.`); continue; }
        choices.push({ submission, status: outcome, portId, portName: catalog.ports.find(port => port.id === portId)?.display_name || portId,
          templates, templateId: templates.length === 1 ? templates[0].id : '', alreadyUpdated: outcome === 'DONE' });
      }
      if (incomplete.length) notifyWarning(`${incomplete.length} email(s) incomplete. ${incomplete.join('\n')}`);
      if (!choices.length) return;
      if (outcome === 'DONE' && choices.every(choice => choice.templateId)) await prepareBatchEmails(choices);
      else { setBatchCodes(choices); setBatchCodePage(0); }
    } catch (error) {
      notifyError(error instanceof Error ? error.message : 'Unable to prepare the registration email.');
    } finally { setSavingCode(false); }
  };

  const prepareBatchEmails = async (choices = batchCodes) => {
    setSavingCode(true);
    const previews: EmailPreview[] = [];
    const incomplete: string[] = [];
    for (const choice of choices) {
      try {
        const template = choice.templates.find(item => item.id === choice.templateId);
        if (!template) throw new Error('Select an email code.');
        if (choice.status === 'REJECTED' && !choice.alreadyUpdated) {
          if (choice.submission.registration_type === 'COMPANY') await rejectCompanySubmission(choice.submission.id, template.rejection_reason || 'OTHER', template.name);
          else await updateSubmissionStatusPersisted(choice.submission.id, 'REJECTED', template.name);
          choice.alreadyUpdated = true;
        }
        previews.push(await generateSubmissionEmailPreview(choice.submission.id, choice.status, template.id, choice.portId));
      } catch (error) { incomplete.push(`${choice.submission.reference_no}: ${error instanceof Error ? error.message : 'Email preview unavailable.'}`); }
    }
    refreshList();
    setBatchCodes([]);
    setSubmissionEmailPreviews(previews); setSubmissionEmailPreviewIndex(0); setEmailSendMode('SUBMISSION');
    setSavingCode(false);
    if (incomplete.length) notifyWarning(`${previews.length} email preview(s) ready, ${incomplete.length} incomplete. ${incomplete.join('\n')}`);
    else if (choices[0]?.status === 'REJECTED') notifySuccess(`${choices.length} registration(s) moved to Rejected. Review the emails before sending.`);
  };

  const submissionEmailPreview = submissionEmailPreviews[submissionEmailPreviewIndex] || null;

  const updateSubmissionEmailPreview = (update: (current: EmailPreview) => EmailPreview) => {
    setSubmissionEmailPreviews((current) => current.map((preview, index) => index === submissionEmailPreviewIndex ? update(preview) : preview));
  };

  const sendAssetRegistrationEmail = async () => {
    if (!submissionEmailPreview) return;
    setSendingSubmissionEmail(true);
    try {
      if (emailSendMode === 'USER') {
        await sendWelcomeEmail(submissionEmailPreview);
      } else {
        const result = await sendSubmissionEmail(submissionEmailPreview);
        if (result.warning) notifyWarning(result.warning);
      }
      await refreshProtectedStorage().catch(() => {});
      refreshList();
      const remaining = submissionEmailPreviews.filter((_, index) => index !== submissionEmailPreviewIndex);
      if (remaining.length) {
        setSubmissionEmailPreviews(remaining);
        setSubmissionEmailPreviewIndex((index) => Math.min(index, remaining.length - 1));
      } else {
        setSubmissionEmailPreviews([]);
        setSubmissionEmailPreviewIndex(0);
        setEmailSendMode('SUBMISSION');
      }
      notifySuccess('Registration email sent through Gmail.');
    } catch (error) {
      notifyError(error instanceof Error ? error.message : 'Unable to send the registration email.');
    } finally {
      setSendingSubmissionEmail(false);
    }
  };

  const handleRevertToPending = async (submission: RegistrationSubmission, reopenLinkedUser = false) => {
    setOpenActionMenu(null);
    setReverting(true);
    try {
      await revertSubmissionToPending(submission.id, reopenLinkedUser);
      setRevertConfirmation(null);
      refreshList();
      notifySuccess(reopenLinkedUser
        ? `${submission.reference_no} and its linked User Registration reverted to pending.`
        : `${submission.reference_no} reverted to pending.`);
    } catch (error) {
      notifyError(error instanceof Error ? error.message : 'Unable to revert the submission.');
    } finally {
      setReverting(false);
    }
  };

  const menuSubmission = submissions.find((submission) => submission.id === openActionMenu?.id);
  const menuCompany = companiesById.get(menuSubmission?.company_id);
  const menuIdInfo = menuSubmission ? getCompanyExternalId({
    company_type: menuCompany?.company_type || menuSubmission.company_type || menuSubmission.data.company?.company_type,
    haulier_id: menuCompany?.haulier_id || menuSubmission.data.company?.haulier_id,
    forwarding_agent_id: menuCompany?.forwarding_agent_id || menuSubmission.data.company?.forwarding_agent_id,
  }) : null;
  const menuCompanyBlockReason = menuSubmission
    ? assetCompanyBlockReason(menuSubmission, menuCompany, submissions)
      || (menuSubmission.registration_type === 'COMPANY' && !menuIdInfo?.has_required_id
        ? `Assign ${menuIdInfo?.required_id_type} before registering this company.`
        : null)
    : null;
  const openSubmissionActionMenu = (button: HTMLButtonElement, submissionId: string) => {
    const rect = button.getBoundingClientRect();
    setOpenActionMenu({ id: submissionId, top: rect.bottom,
      left: Math.max(VIEWPORT_EDGE_PADDING, rect.right - 160),
      anchorTop: rect.top, anchorBottom: rect.bottom, anchorRight: rect.right });
  };
  const toggleActionMenu = (event: React.MouseEvent<HTMLButtonElement>, submissionId: string) => {
    if (openActionMenu?.id === submissionId) {
      setOpenActionMenu(null);
      return;
    }
    openSubmissionActionMenu(event.currentTarget, submissionId);
  };
  const supportsActionMenuHover = () => window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  const isSubmissionActionTarget = (target: EventTarget | null, submissionId: string) => {
    const node = target instanceof Element ? target : target instanceof Node ? target.parentElement : null;
    return !!node && (actionMenuRef.current?.contains(node)
      || node.closest<HTMLElement>('[data-submission-action-trigger]')?.dataset.submissionActionTrigger === submissionId);
  };
  const leaveSubmissionAction = (event: React.PointerEvent<HTMLElement>, submissionId: string) => {
    if (event.pointerType === 'mouse' && supportsActionMenuHover() && !isSubmissionActionTarget(event.relatedTarget, submissionId)) {
      setOpenActionMenu(null);
    }
  };

  return (
    <div className="registration-queue space-y-4 md:space-y-6">
      <div>
        <div>
          <h2 className={`text-lg md:text-xl font-bold tracking-tight ${statusTitleColors[status]}`}>{statusTitles[status]}</h2>
          <p className="mt-1 text-[11px] leading-relaxed text-slate-500 md:text-xs">
            {statusDescriptions[status]}
          </p>
        </div>

      </div>

      {/* Search and queue filters */}
      <div className="queue-toolbar bg-white p-3 sm:p-4 rounded-xl border border-slate-200 shadow-sm">
        <div className="flex flex-col gap-2 sm:gap-3 lg:flex-row lg:items-center lg:gap-3">
        <div className="relative w-full lg:min-w-0 lg:flex-1">
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search reference or company"
            aria-label="Search registration submissions"
            className="w-full px-3.5 py-2 pl-9 rounded-lg border border-slate-300 text-xs focus:border-slate-400 focus:outline-none focus:ring-0"
          />
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
        </div>

        <div className="queue-filters flex w-full flex-nowrap items-center gap-2 overflow-hidden sm:gap-3 lg:w-auto lg:flex-[1.8]">

          <label className="queue-sort flex min-w-0 flex-[1.35] items-center gap-1.5 text-xs font-semibold text-slate-600">
            <select
              value={sortBy}
              onChange={(event) => setSortBy(event.target.value as SubmissionSort)}
              className="h-9 min-w-0 w-full rounded-lg border border-slate-300 bg-white px-2 text-[10px] font-semibold uppercase text-slate-700 focus:border-slate-400 focus:outline-none focus:ring-0 sm:px-3 sm:text-xs"
              aria-label="Sort registration submissions"
            >
              <option value="SUBMITTED_ASC">{status === 'REJECTED' ? 'OLDEST REJECTED' : status === 'DONE' ? 'OLDEST COMPLETED' : 'OLDEST SUBMITTED'}</option>
              <option value="SUBMITTED_DESC">{status === 'REJECTED' ? 'LATEST REJECTED' : status === 'DONE' ? 'LATEST COMPLETED' : 'LATEST SUBMITTED'}</option>
              <option value="COMPANY_ASC">COMPANY NAME A-Z</option>
              <option value="COMPANY_DESC">COMPANY NAME Z-A</option>
            </select>
          </label>

          {/* Port Filter */}
          <select
            aria-label="Filter submissions by facility"
            value={portFilter}
            onChange={(e) => setPortFilter(e.target.value)}
            className="h-9 min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-2 text-[10px] font-semibold uppercase focus:border-slate-400 focus:outline-none focus:ring-0 sm:px-3 sm:text-xs"
          >
            <option value="ALL">ALL FACILITIES</option>
            <option value="PORT_KLANG">PORT KLANG</option>
            <option value="JOHOR">JOHOR</option>
          </select>

          {/* Mobile keeps the same three filter controls for every queue status. */}
            <select
              value={idFilter}
              onChange={(event) => setIdFilter(event.target.value as IdFilter)}
              aria-label="Filter submissions by CargoMove ID status"
              className={`${status !== 'PENDING' ? 'md:hidden ' : ''}h-9 min-w-0 flex-[0.75] rounded-lg border border-slate-300 bg-white px-2 text-[10px] font-semibold uppercase focus:border-slate-400 focus:outline-none focus:ring-0 sm:px-3 sm:text-xs`}
            >
              <option value="ALL">ALL IDS</option>
              <option value="MISSING">MISSING ID</option>
              <option value="WITH_ID">WITH ID</option>
            </select>
          <div className="flex min-w-0 flex-1">
            <QueuePrimaryAction tooltip={primaryActionTooltip}>
              <button
                type="button"
                onClick={handleBulkExport}
                aria-describedby={primaryActionTooltip ? 'queue-primary-action-tooltip' : undefined}
                disabled={selectedIds.length === 0 || exporting || savingCode}
                className="inline-flex h-9 min-w-0 flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-l-lg bg-emerald-600 pl-2 pr-4 text-[10px] font-bold text-white shadow-sm transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-40 sm:pl-3 sm:pr-5"
              >
                {status === 'PENDING'
                  ? exporting
                    ? (companyManualRegistration ? 'EXPORTING...' : 'UPLOADING & VERIFYING...')
                    : companyManualRegistration ? 'MANUAL REGISTER' : 'REGISTER & EMAIL'
                  : 'Export Excel'}
              </button>
            </QueuePrimaryAction>
            <QueueMoreActions
              key={`${status}:${typeFilter}`}
              disabled={exporting || savingCode || !selectedIds.length}
            >
              {status === 'PENDING' && <button role="menuitem" type="button" className="w-full rounded px-3 py-2 text-left text-xs text-slate-700 hover:bg-slate-100" onClick={() => { downloadRegistrationExcel(selectedSubmissions); notifySuccess('Excel downloaded. Registration statuses remain Pending.'); }}><span className="block font-semibold">Export Excel without register</span><span className="mt-0.5 block text-[10px] text-slate-500">Downloads a workbook and keeps these submissions Pending.</span></button>}
              {status === 'PENDING' && <button role="menuitem" type="button" className="w-full rounded px-3 py-2 text-left text-xs text-red-600 hover:bg-red-50" onClick={() => void openSubmissionBatchEmailPreview(selectedSubmissions, 'REJECTED')}><span className="block font-semibold">Reject selected registrations</span><span className="mt-0.5 block text-[10px] text-slate-500">Moves the selected submissions to Rejected.</span></button>}
              {status === 'PENDING' && <button role="menuitem" type="button" disabled={reverting} className="w-full rounded px-3 py-2 text-left text-xs font-semibold text-emerald-700 hover:bg-emerald-50 disabled:opacity-50" onClick={() => void handleBulkMarkDone()}><span className="block">Mark selected as Closed/Done</span><span className="mt-0.5 block text-[10px] font-normal text-slate-500">Moves them to Closed/Done without sending email.</span></button>}
              {status !== 'PENDING' && <button role="menuitem" type="button" disabled={reverting} className="w-full rounded px-3 py-2 text-left text-xs text-amber-700 hover:bg-amber-50 disabled:opacity-50" onClick={() => void handleBulkRevertToPending()}>Revert selected to Pending</button>}
            </QueueMoreActions>
          </div>
        </div>
        </div>
      </div>

      {/* Copy hint, registration type tabs, and table */}
      <div className="rounded-xl">
        <div className="mb-2 hidden md:flex items-center gap-1.5 px-2 text-[11px] font-medium text-slate-500" title="Double-click a table value to copy it to your clipboard.">
          <Info className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>Double-click any table value to copy</span>
        </div>
        <div>
        <div className="queue-type-tabs ml-[0.5px] flex w-fit items-end" role="tablist" aria-label="Registration type">
        {registrationTypeTabs.map(({ value, label }) => {
          const showPendingCount = status === 'PENDING';
          const pendingCount = showPendingCount ? pendingCounts.get(value) || 0 : 0;

          return (
          <button
            key={value}
            type="button"
            onClick={() => setTypeFilter(value)}
            aria-selected={typeFilter === value}
            aria-label={showPendingCount ? `${label}: ${pendingCount} pending registration${pendingCount === 1 ? '' : 's'}` : label}
            role="tab"
            className={`admin-registration-tab relative -mr-px flex h-10 w-[132px] min-w-[132px] items-center justify-center rounded-t-lg border px-3 text-xs font-bold uppercase tracking-wider transition-none ${
              typeFilter === value
                ? `z-10 border-slate-400 border-b-transparent bg-[#CBD5E1] ${statusTitleColors[status]}`
                : 'border-slate-300 bg-[#F1F5F9] text-slate-500 hover:bg-slate-200 hover:text-slate-900'
            }`}
          >
            <span className="flex items-center justify-center gap-2">
              <span>{label}</span>
              {showPendingCount && (
                <span
                  aria-hidden="true"
                  className={`inline-flex h-4 min-w-4 items-center justify-center rounded-full px-0.5 text-[8px] font-bold leading-none ${
                    pendingCount > 0 ? 'bg-orange-500 text-white shadow-sm' : 'bg-slate-200 text-slate-600'
                  }`}
                >
                  {pendingCount > 9 ? '9+' : pendingCount}
                </span>
              )}
            </span>
          </button>
          );
        })}
        </div>
        </div>

      {/* Submissions Table */}
        <div className="queue-results overflow-hidden rounded-b-xl rounded-tr-xl border-x border-b border-slate-200 bg-white shadow-sm">
          <div className="hidden overflow-hidden md:block">
          <table className="registration-queue-table w-full table-fixed border-collapse text-left text-xs">
            <colgroup>
              <col style={{ width: '32px' }} />
              <col style={{ width: '128px' }} />
              <col />
              <col style={{ width: '96px' }} />
              <col style={{ width: '90px' }} />
              <col style={{ width: '112px' }} />
              <col style={{ width: '120px' }} />
              <col style={{ width: '96px' }} />
              <col style={{ width: '56px' }} />
            </colgroup>
            <thead>
              <tr className="admin-registration-table-header whitespace-nowrap border border-slate-400 bg-[#CBD5E1] font-bold uppercase tracking-wider text-slate-700">
                <th className="py-3 px-3 w-8 text-center">
                  <input
                    type="checkbox"
                    checked={
                      filteredSubmissions.length > 0 &&
                      selectedIds.length === filteredSubmissions.length
                    }
                    onChange={handleSelectAll}
                    className="rounded text-blue-600 focus:ring-blue-500"
                  />
                </th>
                <th className="py-3 px-4">Reference No</th>
                <th className="py-3 px-4">Company Name</th>
                <th className="py-3 px-3 text-center">Type</th>
                <th className="py-3 px-3">Facility</th>
                <th className="py-3 px-3">Cargomove ID</th>
                <th className="py-3 px-3 text-center">Status</th>
                <th className="py-3 px-3 text-center">Submitted</th>
                <th className="py-3 px-4 text-center">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {paginatedSubmissions.length === 0 ? (
                <tr>
                  <td colSpan={9} className="align-middle text-center text-slate-500" style={{ height: MINIMUM_VISIBLE_ROWS * SUBMISSION_ROW_HEIGHT }}>
                    No submissions found matching criteria.
                  </td>
                </tr>
              ) : (
                <>
                {paginatedSubmissions.map((sub, index) => {
                  const company = companiesById.get(sub.company_id);
                  const idInfo = getCompanyExternalId({
                    company_type: company?.company_type || sub.company_type || sub.data.company?.company_type,
                    haulier_id: company?.haulier_id || sub.data.company?.haulier_id,
                    forwarding_agent_id: company?.forwarding_agent_id || sub.data.company?.forwarding_agent_id,
                  });
                  const isSelected = selectedIds.includes(sub.id);
                  const companyName = sub.company_name.toUpperCase();
                  const companyType = (company?.company_type || sub.company_type || '—').toUpperCase();
                  const facility = sub.port_location === 'PORT_KLANG' ? 'PORT KLANG' : sub.port_location === 'JOHOR' ? 'JOHOR' : 'OTHER PORT';
                  const submittedDate = formatAdminDate(sub.submitted_at);

                  return (
                    <tr
                      key={sub.id}
                      className={`transition-colors hover:bg-slate-100/70 ${
                        isSelected ? 'bg-blue-50/40' : index % 2 === 0 ? 'bg-white' : 'bg-slate-100/70'
                      }`}
                    >
                      <td className="py-3 px-3 text-center">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => handleToggleSelect(sub.id)}
                          className="rounded text-blue-600 focus:ring-blue-500"
                        />
                      </td>

                      <td
                        className="cursor-pointer select-none py-3 px-4 font-mono font-bold text-slate-900"
                        onClick={() => setActiveSubmission(sub)}
                        title="Click to review"
                      >
                        <RegistrationReference submission={sub} />
                      </td>

                      <td
                        className="cursor-copy select-none py-3 px-4"
                        onDoubleClick={() => void handleCopyQueueValue(companyName, 'Company name')}
                        title="Double-click to copy company name"
                      >
                        <QueueCompanyName submission={sub} company={company} submissions={submissions}
                          registrationStatus={companyRegistrationStatuses.get(sub.company_id)}
                          highlight={status === 'PENDING' && ['DRIVER', 'TRAILER', 'VEHICLE'].includes(typeFilter)}
                          className="block truncate whitespace-nowrap" />
                      </td>

                      <td
                        className="cursor-copy select-none py-3 px-3 text-center"
                        onDoubleClick={() => void handleCopyQueueValue(companyType, 'Type')}
                        title="Double-click to copy type"
                      >
                        <span className="admin-registration-copy-text text-[11px] font-semibold text-slate-700">
                          {companyType}
                        </span>
                      </td>

                      <td
                        className="cursor-copy select-none py-2.5 px-3"
                        onDoubleClick={() => void handleCopyQueueValue(facility, 'Facility')}
                        title="Double-click to copy facility"
                      >
                        <span className="admin-registration-copy-text text-[11px] font-semibold text-slate-700">
                          {facility}
                        </span>
                      </td>

                      {/* Backend ID Linkage Status */}
                      <td
                        className={`${idInfo.has_required_id ? 'cursor-copy select-none' : ''} py-3 px-3 font-mono`}
                        onDoubleClick={idInfo.has_required_id ? () => void handleCopyQueueValue(idInfo.active_id_value || '', 'Cargomove ID') : undefined}
                        title={idInfo.has_required_id ? 'Double-click to copy Cargomove ID' : undefined}
                      >
                        {idInfo.has_required_id ? (
                          <span className="admin-registration-copy-text">
                            <CargoMoveIdBadge id={idInfo.active_id_value || ''} />
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleOpenAssignIdForSub(sub)}
                            className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-700 hover:bg-amber-100"
                          >
                            <AlertTriangle className="w-3 h-3 text-amber-700" />
                            <span>ID Required</span>
                          </button>
                        )}
                      </td>

                      <td
                        className="cursor-copy select-none py-3 px-3"
                        onDoubleClick={() => void handleCopyQueueValue(sub.status, 'Status')}
                        title="Double-click to copy status"
                      >
                        <span className="admin-registration-copy-text inline-flex">
                          <StatusBadge status={sub.status} />
                        </span>
                      </td>

                      <td
                        className="cursor-copy select-none py-3 px-3 text-center text-[11px] text-slate-500"
                        onDoubleClick={() => void handleCopyQueueValue(submittedDate, 'Submitted date')}
                        title="Double-click to copy submitted date"
                      >
                        <span className="admin-registration-copy-text">
                          {submittedDate}
                        </span>
                      </td>

                      <td className="relative py-3 px-4 text-center">
                        <button
                          type="button"
                          data-submission-action-trigger={sub.id}
                          onPointerEnter={(event) => { if (event.pointerType === 'mouse' && supportsActionMenuHover()) openSubmissionActionMenu(event.currentTarget, sub.id); }}
                          onPointerLeave={(event) => leaveSubmissionAction(event, sub.id)}
                          onClick={(event) => { if (!supportsActionMenuHover() || event.detail === 0) toggleActionMenu(event, sub.id); }}
                          aria-label={`Actions for ${sub.reference_no}`}
                          aria-expanded={openActionMenu?.id === sub.id}
                          className="inline-flex items-center justify-center rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                        >
                          <MoreVertical className="w-4 h-4" />
                        </button>

                      </td>
                    </tr>
                  );
                })}
                {submissionSpacerHeight > 0 && (
                  <tr aria-hidden="true">
                    <td colSpan={9} className="p-0" style={{ height: submissionSpacerHeight }} />
                  </tr>
                )}
                </>
              )}
            </tbody>
          </table>
          </div>
          <div className="space-y-2 md:hidden" role="list" aria-label="Registration submission cards">
            <div className="flex min-h-10 items-center justify-between gap-2 px-1 text-[11px] text-slate-500">
              <span>{sortedSubmissions.length} submission{sortedSubmissions.length === 1 ? '' : 's'}</span>
              <label className="flex min-h-10 items-center gap-2 font-medium">
                <input type="checkbox" aria-label="Select all filtered submissions" checked={filteredSubmissions.length > 0 && filteredSubmissions.every((sub) => selectedIds.includes(sub.id))} onChange={handleSelectAll} className="h-4 w-4 rounded accent-blue-600" />
                Select all
              </label>
            </div>
            {paginatedSubmissions.length === 0 && (
              <div className="rounded-lg border border-dashed border-slate-300 bg-white px-4 py-10 text-center text-xs text-slate-500">No submissions found matching criteria.</div>
            )}
            {paginatedSubmissions.map((sub) => {
              const company = companiesById.get(sub.company_id);
              const idInfo = getCompanyExternalId(company || { company_type: sub.company_type });
              const facility = sub.port_location === 'PORT_KLANG' ? 'PORT KLANG' : sub.port_location === 'JOHOR' ? 'JOHOR' : 'OTHER PORT';
              const isSelected = selectedIds.includes(sub.id);
              return (
                <article role="listitem" key={sub.id} className={`min-w-0 rounded-lg border p-3 shadow-sm ${isSelected ? 'border-blue-300 bg-blue-50' : 'border-slate-200 bg-white'}`}>
                  <div className="flex items-start gap-2">
                    <button type="button" onClick={() => setActiveSubmission(sub)} className="min-w-0 flex-1 text-left">
                      <QueueCompanyName submission={sub} company={company} submissions={submissions}
                        registrationStatus={companyRegistrationStatuses.get(sub.company_id)}
                        highlight={status === 'PENDING' && ['DRIVER', 'TRAILER', 'VEHICLE'].includes(typeFilter)}
                        className="block break-words text-xs leading-5" />
                    </button>
                    <button type="button" data-submission-action-trigger={sub.id}
                      onPointerEnter={(event) => { if (event.pointerType === 'mouse' && supportsActionMenuHover()) openSubmissionActionMenu(event.currentTarget, sub.id); }}
                      onPointerLeave={(event) => leaveSubmissionAction(event, sub.id)}
                      onClick={(event) => { if (!supportsActionMenuHover() || event.detail === 0) toggleActionMenu(event, sub.id); }}
                      aria-label={`Actions for ${sub.reference_no}`} aria-expanded={openActionMenu?.id === sub.id} className="-mr-1 -mt-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100"><MoreVertical className="h-4 w-4" /></button>
                  </div>
                  <div className="mt-1 text-[10px] text-blue-600"><RegistrationReference submission={sub} /></div>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[9px] font-semibold uppercase text-slate-600">
                    <span className="rounded bg-slate-100 px-1.5 py-1">{company?.company_type || sub.company_type || sub.registration_type}</span>
                    {sub.company_reg_no && <span className="break-all font-normal">{sub.company_reg_no}</span>}
                    <span className="ml-auto whitespace-nowrap">{facility}</span>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-2">
                    {idInfo.has_required_id ? <CargoMoveIdBadge id={idInfo.active_id_value || ''} /> : (
                      <button type="button" onClick={() => handleOpenAssignIdForSub(sub)} className="inline-flex min-h-8 items-center gap-1 rounded-md bg-amber-50 px-2 text-[10px] font-semibold text-amber-700"><AlertTriangle className="h-3 w-3" />ID required</button>
                    )}
                    <span className="text-[10px] text-slate-500">Submitted {formatAdminDate(sub.submitted_at)}</span>
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <label className="flex min-h-10 items-center gap-2 text-[10px] font-medium text-slate-500"><input type="checkbox" checked={isSelected} onChange={() => handleToggleSelect(sub.id)} aria-label={`Select ${sub.reference_no}`} className="h-4 w-4 rounded accent-blue-600" />Select</label>
                    <button type="button" onClick={() => setActiveSubmission(sub)} className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-md bg-blue-600 px-4 text-[10px] font-bold text-white hover:bg-blue-700"><Eye className="h-3.5 w-3.5" />REVIEW</button>
                  </div>
                </article>
              );
            })}
          </div>
          <div className="queue-pagination-footer flex flex-col gap-3 border-t border-slate-200 bg-slate-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="hidden md:flex items-center gap-3 text-xs text-slate-500">
              <span>
                {sortedSubmissions.length
                  ? `Showing ${pageStart + 1}-${Math.min(pageStart + pageSize, sortedSubmissions.length)} of ${sortedSubmissions.length}`
                  : 'Showing 0 submissions'}
              </span>
              <label className="flex items-center gap-2">
                <span>Show</span>
                <select
                  value={pageSize}
                  onChange={(event) => setPageSize(Number(event.target.value))}
                  className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 focus:border-slate-400 focus:outline-none"
                  aria-label="Submissions per page"
                >
                  {PAGE_SIZE_OPTIONS.map((size) => <option key={size} value={size}>{size}</option>)}
                </select>
              </label>
            </div>

            <nav className="queue-pagination flex items-center gap-1" aria-label="Registration queue pagination">
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

      {openActionMenu && menuSubmission && createPortal(
        <div
          ref={actionMenuRef}
          style={{
            top: openActionMenu.top,
            left: openActionMenu.left,
            maxHeight: `calc(100vh - ${VIEWPORT_EDGE_PADDING * 2}px)`,
            paddingTop: openActionMenu.top >= openActionMenu.anchorBottom ? ACTION_MENU_GAP : 0,
            paddingBottom: openActionMenu.top < openActionMenu.anchorBottom ? ACTION_MENU_GAP : 0,
          }}
          className="fixed z-50 w-40 text-left"
          onPointerLeave={(event) => leaveSubmissionAction(event, menuSubmission.id)}
        >
          <div role="menu" style={{ maxHeight: `calc(100vh - ${VIEWPORT_EDGE_PADDING * 2 + ACTION_MENU_GAP}px)` }} className="overflow-y-auto rounded-lg border border-slate-200 bg-white p-1 shadow-xl">
            <button role="menuitem" type="button" onClick={() => { setActiveSubmission(menuSubmission); setOpenActionMenu(null); }} className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100">
              <Eye className="w-3.5 h-3.5" /> Review
            </button>
            {menuSubmission.status === 'PENDING' && (
              <>
                <button role="menuitem" type="button" onClick={() => void startCodeFlow(menuSubmission, 'DONE')} disabled={savingCode || !!menuCompanyBlockReason} title={menuCompanyBlockReason || undefined} className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-xs font-semibold text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"><CircleCheck className="h-3.5 w-3.5" />{menuSubmission.cargomove_upload?.state === 'SUCCESS' ? 'Preview Email' : 'Register'}</button>
                <button role="menuitem" type="button" onClick={() => void startCodeFlow(menuSubmission, 'REJECTED')} disabled={savingCode} className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-50"><CircleX className="h-3.5 w-3.5" />Reject</button>
              </>
            )}
            {menuSubmission.status !== 'PENDING' && (
              <>
                <button role="menuitem" type="button" onClick={() => void startCodeFlow(menuSubmission, menuSubmission.status as 'DONE' | 'REJECTED', { alreadyUpdated: true })} disabled={savingCode} className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-xs font-semibold text-blue-700 hover:bg-blue-50 disabled:opacity-50"><Mail className="h-3.5 w-3.5" /> Preview Email</button>
                <button role="menuitem" type="button" onClick={() => {
                  setOpenActionMenu(null);
                  if (menuSubmission.registration_type === 'COMPANY' && menuSubmission.status === 'REJECTED') setRevertConfirmation(menuSubmission);
                  else void handleRevertToPending(menuSubmission);
                }} className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-xs font-semibold text-amber-700 hover:bg-amber-50">
                  <RotateCcw className="h-3.5 w-3.5" /> Revert to Pending
                </button>
              </>
            )}
          </div>
        </div>,
        document.body,
      )}

      {/* Submission Detail Modal */}
      {uploadProgress && <p role="status" className="text-xs text-blue-700">{uploadProgress}</p>}
      <SubmissionDetailModal
        submission={submissions.find(sub => sub.id === activeSubmission?.id) || activeSubmission}
        isOpen={!!activeSubmission}
        onClose={() => setActiveSubmission(null)}
        onOpenAssignId={(companyId) => {
          const company = getCompanyById(companyId);
          if (company) setAssignIdCompany(company);
        }}
        onStatusChange={() => {
          refreshList();
          if (activeSubmission) {
            const updated = getSubmissions().find((s) => s.id === activeSubmission.id);
            setActiveSubmission(updated || null);
          }
        }}
        onStatusUpdate={(submission, nextStatus, notes) => void startCodeFlow(submission, nextStatus, { adminNotes: notes })}
        onExportSuccess={(submission) => {
          void startCodeFlow(submission, 'DONE', { alreadyUpdated: true });
        }}
      />

      {/* Assign ID Modal */}
      <AssignIdModal
        company={assignIdCompany}
        isOpen={!!assignIdCompany}
        onClose={() => setAssignIdCompany(null)}
        onSuccess={() => {
          refreshList();
        }}
      />

      {revertConfirmation && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/55 p-4 backdrop-blur-xs">
          <div role="dialog" aria-modal="true" aria-labelledby="revert-company-title" className="w-full max-w-lg overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-2xl">
            <div className="flex items-start justify-between border-b border-slate-200 bg-amber-50 px-5 py-4">
              <div>
                <h3 id="revert-company-title" className="font-bold text-slate-900">Revert rejected company to pending?</h3>
                <p className="mt-1 text-xs text-slate-600">{revertConfirmation.reference_no} · {revertConfirmation.company_name}</p>
              </div>
              <button type="button" onClick={() => setRevertConfirmation(null)} disabled={reverting} aria-label="Close confirmation" className="rounded-lg p-1 text-slate-400 hover:text-slate-700 disabled:opacity-50"><X className="h-5 w-5" /></button>
            </div>
            <div className="p-5 text-sm text-slate-700">
              Choose whether the linked User Registration should also return to Pending or remain Rejected.
            </div>
            <div className="flex flex-col-reverse gap-2 border-t border-slate-200 bg-slate-50 px-5 py-4 sm:flex-row sm:justify-end">
              <button type="button" onClick={() => setRevertConfirmation(null)} disabled={reverting} className="rounded-lg px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-200 disabled:opacity-50">Cancel</button>
              <button type="button" onClick={() => void handleRevertToPending(revertConfirmation, false)} disabled={reverting} className="rounded-lg border border-rose-300 bg-white px-4 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-50">Revert company only</button>
              <button type="button" onClick={() => void handleRevertToPending(revertConfirmation, true)} disabled={reverting} className="rounded-lg bg-amber-600 px-4 py-2 text-xs font-bold text-white hover:bg-amber-700 disabled:opacity-50">Revert company and user</button>
            </div>
          </div>
        </div>
      )}

      {codeSelection && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/55 p-4 backdrop-blur-xs">
          <div role="dialog" aria-modal="true" aria-labelledby="select-email-code-title" className="w-full max-w-lg overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-2xl">
            <div className={`flex items-center justify-between border-b border-slate-200 px-5 py-4 ${codeSelection.status === 'REJECTED' ? 'bg-rose-50' : 'bg-emerald-50'}`}>
              <div>
                <h3 id="select-email-code-title" className="font-bold text-slate-900">Select {codeSelection.status === 'DONE' ? 'acceptance' : 'rejection'} code</h3>
                <p className="mt-0.5 text-xs text-slate-600">{codeSelection.submission.reference_no} · {codeSelection.portName}</p>
              </div>
              <button type="button" onClick={() => setCodeSelection(null)} disabled={savingCode} aria-label="Close code selection" className="rounded-lg p-1 text-slate-400 hover:text-slate-700"><X className="h-5 w-5" /></button>
            </div>
            <div className="max-h-[60vh] space-y-2 overflow-y-auto p-5">
              {codeSelection.templates.map((template) => (
                <label key={template.id} className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm transition ${selectedCodeId === template.id ? codeSelection.status === 'REJECTED' ? 'border-rose-400 bg-rose-50' : 'border-emerald-400 bg-emerald-50' : 'border-slate-200 hover:bg-slate-50'}`}>
                  <input type="radio" name="submission-email-code" value={template.id} checked={selectedCodeId === template.id} onChange={() => setSelectedCodeId(template.id)} className="mt-0.5" />
                  <span><strong className="block text-slate-900">{template.template_code} — {template.name}</strong><span className="mt-1 block text-xs text-slate-500">{template.subject_template}</span></span>
                </label>
              ))}
              {codeSelection.submission.registration_type === 'COMPANY' && codeSelection.status === 'REJECTED' && <p className="text-xs text-slate-500">Rejecting the company also rejects its linked User Registration. You can review the email before sending.</p>}
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-4">
              <button type="button" onClick={() => setCodeSelection(null)} disabled={savingCode} className="rounded-lg px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-200">Cancel</button>
              <button type="button" onClick={() => { const template = codeSelection.templates.find((item) => item.id === selectedCodeId); if (template) void applyCodeAndPreview(codeSelection, template); }} disabled={savingCode || !selectedCodeId} className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-bold text-white disabled:opacity-50 ${codeSelection.status === 'REJECTED' ? 'bg-rose-600 hover:bg-rose-700' : 'bg-emerald-600 hover:bg-emerald-700'}`}><Mail className="h-4 w-4" />{savingCode ? 'Preparing...' : 'Preview Email'}</button>
            </div>
          </div>
        </div>
      )}

      {batchCodes.length > 0 && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/55 p-4">
        <div role="dialog" aria-modal="true" aria-label="Batch email codes" className="w-full max-w-xl rounded-2xl bg-white p-5 shadow-2xl">
          <div className="flex items-center justify-between"><h3 className="font-bold text-slate-900">Select {batchCodes[0].status === 'REJECTED' ? 'rejection' : 'acceptance'} codes</h3><button type="button" aria-label="Close batch email codes" disabled={savingCode} onClick={() => setBatchCodes([])}><X className="h-5 w-5" /></button></div>
          <p className="mt-3 text-sm font-semibold">{batchCodes[batchCodePage].submission.reference_no} · {batchCodes[batchCodePage].submission.company_name}</p>
          <p className="mt-1 text-xs text-slate-500">{batchCodes[batchCodePage].portName}</p>
          <label className="mt-4 block text-xs font-semibold">Email code<select aria-label="Batch email code" disabled={savingCode} value={batchCodes[batchCodePage].templateId} onChange={event => setBatchCodes(current => current.map((choice, index) => index === batchCodePage ? { ...choice, templateId: event.target.value } : choice))} className="mt-2 w-full rounded-lg border border-slate-300 p-2 text-sm"><option value="">Select a code</option>{batchCodes[batchCodePage].templates.map(template => <option key={template.id} value={template.id}>{template.template_code} — {template.name}</option>)}</select></label>
          <nav aria-label="Batch email code pagination" className="my-5 flex justify-center gap-1">{getVisiblePageNumbers(batchCodePage + 1, batchCodes.length).map(page => <button type="button" key={page} disabled={savingCode} aria-label={`Batch code page ${page}`} aria-current={batchCodePage + 1 === page ? 'page' : undefined} onClick={() => setBatchCodePage(page - 1)} className={`rounded border px-3 py-2 text-xs ${batchCodePage + 1 === page ? 'bg-blue-600 text-white' : 'text-slate-700'}`}>{page}</button>)}</nav>
          <div className="flex justify-end gap-2"><button type="button" disabled={savingCode} onClick={() => setBatchCodes([])} className="px-3 py-2 text-xs text-slate-600">Cancel</button><button type="button" onClick={() => void prepareBatchEmails()} disabled={savingCode || batchCodes.some(choice => !choice.templateId)} className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-bold text-white disabled:opacity-40">{savingCode ? 'Preparing...' : batchCodes[0].status === 'REJECTED' ? 'Reject and preview emails' : 'Preview emails'}</button></div>
        </div>
      </div>}

      {submissionEmailPreview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/55 p-4 backdrop-blur-xs">
          <div role="dialog" aria-modal="true" aria-labelledby="submission-email-preview-title" className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-5 py-4">
              <div><h3 id="submission-email-preview-title" className="font-bold text-slate-900">Registration Email Preview</h3><p className="mt-0.5 text-xs text-slate-500">{submissionEmailPreview.templateCode ? `${submissionEmailPreview.templateCode} — ` : ''}{submissionEmailPreview.templateName}{submissionEmailPreview.portId ? ` · ${submissionEmailPreview.portId}` : ''}</p></div>
              <button type="button" onClick={() => setSubmissionEmailPreviews([])} disabled={sendingSubmissionEmail} aria-label="Close email preview" className="rounded-lg p-1 text-slate-400 hover:text-slate-700"><X className="h-5 w-5" /></button>
            </div>
            <div className="space-y-4 overflow-y-auto p-5">
              <label className="block text-xs font-semibold text-slate-700">To<input value={submissionEmailPreview.recipient} readOnly className="mt-1.5 w-full rounded-lg border border-slate-200 bg-slate-100 px-3 py-2 font-normal text-slate-700" /></label>
              <label className="block text-xs font-semibold text-slate-700">Subject<input value={submissionEmailPreview.subject} onChange={(event) => updateSubmissionEmailPreview((current) => ({ ...current, subject: event.target.value }))} className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 font-normal" /></label>
              {submissionEmailPreview.attachments.map((attachment) => <div key={attachment.path} className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs"><span className="flex min-w-0 items-center gap-3"><PdfAttachmentIcon /><span className="min-w-0"><span className="block text-slate-500">Attachment</span><strong className="block truncate text-slate-800" title={attachment.name}>{attachment.name}</strong></span></span>{attachment.path.startsWith('/api/email/submission-attachment') && <span className="flex shrink-0 gap-3"><a href={attachment.path} target="_blank" rel="noreferrer" className="font-semibold text-blue-600 hover:text-blue-800">View</a><a href={`${attachment.path}&download=1`} className="font-semibold text-blue-600 hover:text-blue-800">Download</a></span>}</div>)}
              <div className="text-xs font-semibold text-slate-700">Message<RichTextEmailEditor value={submissionEmailPreview.body} onChange={(body) => updateSubmissionEmailPreview((current) => ({ ...current, body }))} minHeightClassName="min-h-64" /></div>
            </div>
            <div className="relative flex flex-col items-center gap-3 border-t border-slate-200 bg-slate-50 px-5 py-4 sm:flex-row sm:justify-end">
              {submissionEmailPreviews.length > 1 && (
                <nav className="flex items-center gap-1 sm:absolute sm:left-1/2 sm:-translate-x-1/2" aria-label="Email preview pagination">
                  <button
                    type="button"
                    onClick={() => setSubmissionEmailPreviewIndex((index) => Math.max(0, index - 1))}
                    disabled={sendingSubmissionEmail || submissionEmailPreviewIndex === 0}
                    aria-label="Previous email preview"
                    className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-slate-300 bg-white text-2xl font-light text-slate-500 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    ‹
                  </button>
                  {getVisiblePageNumbers(submissionEmailPreviewIndex + 1, submissionEmailPreviews.length).map((page) => (
                    <button
                      key={page}
                      type="button"
                      onClick={() => setSubmissionEmailPreviewIndex(page - 1)}
                      aria-current={submissionEmailPreviewIndex + 1 === page ? 'page' : undefined}
                      aria-label={`Email preview page ${page}`}
                      className={`inline-flex h-10 min-w-10 items-center justify-center rounded-lg border px-3 text-base font-bold ${submissionEmailPreviewIndex + 1 === page ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-100'}`}
                    >
                      {page}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => setSubmissionEmailPreviewIndex((index) => Math.min(submissionEmailPreviews.length - 1, index + 1))}
                    disabled={sendingSubmissionEmail || submissionEmailPreviewIndex === submissionEmailPreviews.length - 1}
                    aria-label="Next email preview"
                    className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-slate-300 bg-white text-2xl font-light text-slate-500 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    ›
                  </button>
                </nav>
              )}
              <div className="flex gap-2 sm:ml-auto">
                <button type="button" onClick={() => setSubmissionEmailPreviews([])} disabled={sendingSubmissionEmail} className="rounded-lg px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-200">Cancel</button>
                <button type="button" onClick={() => void sendAssetRegistrationEmail()} disabled={sendingSubmissionEmail} className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-xs font-bold text-white hover:bg-blue-700 disabled:opacity-60"><Mail className="h-4 w-4" />{sendingSubmissionEmail ? 'Sending...' : 'Send Email'}</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
