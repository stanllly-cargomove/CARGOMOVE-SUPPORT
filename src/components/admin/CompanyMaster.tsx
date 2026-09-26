import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import * as XLSX from 'xlsx';
import { Company } from '../../types';
import {
  getCompanies,
  saveCompanyPersisted,
  checkDuplicateRegNo,
  getPorts,
  getDepots,
  subscribeToStorage,
} from '../../services/storage';
import { getCompanyExternalId, normalizeCompanyType, normalizeRegNo } from '../../services/companyHelper';
import { AssignIdModal } from './AssignIdModal';
import {
  Search,
  Plus,
  Key,
  Filter,
  Edit2,
  X,
  MoreVertical,
  ClipboardPaste,
  FileSpreadsheet,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { notifyError, notifySuccess, notifyWarning } from '../common/notifications';
import { COMPANY_STATES_BY_COUNTRY } from '../../constants/companyLocations';
import { formatAdminDate } from '../../utils/date';

type CompanySort = 'CREATED_DESC' | 'CREATED_ASC' | 'UPDATED_DESC' | 'NAME_ASC' | 'NAME_DESC';

const PAGE_SIZE_OPTIONS = [20, 30, 50];

export function CompanyMaster() {
  const [companies, setCompanies] = useState<Company[]>(getCompanies());
  const [searchTerm, setSearchTerm] = useState('');
  const [typeFilter, setTypeFilter] = useState('ALL');
  const [portFilter, setPortFilter] = useState('ALL');
  const [missingIdOnly, setMissingIdOnly] = useState(false);
  const [sortBy, setSortBy] = useState<CompanySort>('CREATED_DESC');
  const [pageSize, setPageSize] = useState(20);
  const [currentPage, setCurrentPage] = useState(1);
  const [isNarrowToolbar, setIsNarrowToolbar] = useState(false);

  // Modals
  const [selectedCompanyForId, setSelectedCompanyForId] = useState<Company | null>(null);
  const [isNewCompanyModalOpen, setIsNewCompanyModalOpen] = useState(false);
  const [editingCompany, setEditingCompany] = useState<Company | null>(null);
  const [activeActionMenuId, setActiveActionMenuId] = useState<string | null>(null);

  const ports = getPorts();

  useEffect(() => {
    const mediaQuery = window.matchMedia('(max-width: 767px)');
    const updateToolbarMode = () => setIsNarrowToolbar(mediaQuery.matches);
    updateToolbarMode();
    mediaQuery.addEventListener('change', updateToolbarMode);
    return () => mediaQuery.removeEventListener('change', updateToolbarMode);
  }, []);

  const refreshList = () => {
    setCompanies(getCompanies());
  };

  useEffect(() => subscribeToStorage(refreshList), []);

  useEffect(() => {
    setCurrentPage(1);
    setActiveActionMenuId(null);
  }, [searchTerm, typeFilter, portFilter, missingIdOnly, sortBy, pageSize]);

  const filteredCompanies = companies.filter((comp) => {
    // Search query
    const term = searchTerm.toLowerCase();
    const matchesSearch =
      !term ||
      comp.name.toLowerCase().includes(term) ||
      comp.short_name?.toLowerCase().includes(term) ||
      comp.registration_number.toLowerCase().includes(term) ||
      comp.registration_number_old?.toLowerCase().includes(term) ||
      comp.registration_number_new?.toLowerCase().includes(term);

    // Type filter
    const matchesType = typeFilter === 'ALL' || normalizeCompanyType(comp.company_type) === typeFilter;

    // Port filter
    const assignedPortIds = comp.assigned_port_ids?.length
      ? comp.assigned_port_ids
      : comp.port_id ? [comp.port_id] : [];
    const matchesPort = portFilter === 'ALL' || assignedPortIds.includes(portFilter);

    // Missing ID filter
    const idInfo = getCompanyExternalId(comp);
    const matchesMissingId = !missingIdOnly || !idInfo.has_required_id;

    return matchesSearch && matchesType && matchesPort && matchesMissingId;
  });

  const sortedCompanies = [...filteredCompanies].sort((left, right) => {
    if (sortBy === 'NAME_ASC') return left.name.localeCompare(right.name);
    if (sortBy === 'NAME_DESC') return right.name.localeCompare(left.name);
    if (sortBy === 'CREATED_ASC') return Date.parse(left.created_at) - Date.parse(right.created_at);
    if (sortBy === 'UPDATED_DESC') return Date.parse(right.updated_at) - Date.parse(left.updated_at);
    return Date.parse(right.created_at) - Date.parse(left.created_at);
  });
  const totalPages = Math.max(1, Math.ceil(sortedCompanies.length / pageSize));
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const pageStart = (safeCurrentPage - 1) * pageSize;
  const paginatedCompanies = sortedCompanies.slice(pageStart, pageStart + pageSize);
  const pageNumbers = getVisiblePageNumbers(safeCurrentPage, totalPages);

  useEffect(() => {
    if (currentPage > totalPages) setCurrentPage(totalPages);
  }, [currentPage, totalPages]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 tracking-tight">Company Master Database</h2>
          <p className="text-xs text-slate-500 mt-1">
            Permanent mapping registry for automated HAULIERID and FORWARDING_AGENT_ID resolution.
          </p>
        </div>

        <button
          type="button"
          onClick={() => {
            setEditingCompany(null);
            setIsNewCompanyModalOpen(true);
          }}
          className="inline-flex items-center px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold transition-colors shadow-sm self-start sm:self-auto"
        >
          <Plus className="w-4 h-4 mr-1.5" />
          Add Company
        </button>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex min-w-0 flex-nowrap items-center gap-2 overflow-hidden rounded-xl border border-slate-200 bg-white p-3 shadow-sm md:gap-3 md:p-4">
        <div className="relative w-36 min-w-0 shrink md:w-64">
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search by Registration No (AAAAAA-2) or Company Name..."
            className="w-full px-3.5 py-2 pl-9 rounded-lg border border-slate-300 text-xs focus:border-slate-400 focus:outline-none"
          />
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
        </div>

        <div className="ml-auto flex shrink-0 flex-nowrap items-center gap-2">
          <label className="hidden items-center gap-2 text-xs font-semibold text-slate-600 md:flex" htmlFor="company-sort">
            <span className="whitespace-nowrap">Sort by</span>
            <select
              id="company-sort"
              value={sortBy}
              onChange={(event) => setSortBy(event.target.value as CompanySort)}
              className="px-3 py-2 rounded-lg border border-slate-300 text-xs font-normal text-slate-700 bg-white focus:border-slate-400 focus:outline-none"
            >
              <option value="CREATED_DESC">Latest added</option>
              <option value="CREATED_ASC">Oldest added</option>
              <option value="UPDATED_DESC">Recently updated</option>
              <option value="NAME_ASC">Company name A-Z</option>
              <option value="NAME_DESC">Company name Z-A</option>
            </select>
          </label>

          {/* Company Type Filter */}
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="w-24 min-w-0 rounded-lg border border-slate-300 bg-white px-2 py-2 text-xs focus:border-slate-400 focus:outline-none md:w-auto md:px-3"
          >
            <option value="ALL">All Types</option>
            <option value="FORWARDER">FORWARDER</option>
            <option value="HAULAGE">HAULAGE</option>
            <option value="TRANSPORT">TRANSPORT</option>
          </select>

          {/* Port Filter */}
          <select
            value={portFilter}
            onChange={(e) => setPortFilter(e.target.value)}
            className="w-28 min-w-0 rounded-lg border border-slate-300 bg-white px-2 py-2 text-xs focus:border-slate-400 focus:outline-none md:w-auto md:px-3"
          >
            <option value="ALL">All Ports</option>
            {ports.map((p) => (
              <option key={p.id} value={p.id}>
                {p.display_name}
              </option>
            ))}
          </select>

          {/* Missing ID Toggle */}
          <button
            type="button"
            onClick={() => {
              const nextValue = !missingIdOnly;
              setMissingIdOnly(nextValue);
              if (isNarrowToolbar) notifySuccess(`Missing IDs filter ${nextValue ? 'enabled' : 'disabled'}.`);
            }}
            aria-label={missingIdOnly ? 'Disable Missing IDs Only filter' : 'Enable Missing IDs Only filter'}
            title={missingIdOnly ? 'Disable Missing IDs Only' : 'Enable Missing IDs Only'}
            className={`inline-flex h-9 shrink-0 items-center justify-center rounded-lg border text-[0px] font-bold transition-colors focus:outline-none md:h-auto md:px-3 md:py-2 md:text-xs ${
              missingIdOnly
                ? 'bg-amber-100 text-amber-800 border-amber-300'
                : 'bg-slate-50 text-slate-600 border-slate-300 hover:bg-slate-100'
            }`}
          >
            <Filter className="h-4 w-4 md:hidden" />
            <span className="hidden">Missing IDs Only</span>
            ⚠ Missing IDs Only
          </button>
        </div>
      </div>

      {/* Companies Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-bold uppercase tracking-wider">
                <th className="py-3 px-4">Company Name</th>
                <th className="py-3 px-3 text-center">Reg. Old</th>
                <th className="py-3 px-3 text-center">Reg. New</th>
                <th className="py-3 px-3 text-center">Type</th>
                <th className="py-3 px-4">Cargomove ID</th>
                <th className="py-3 px-3 text-center">Facility</th>
                <th className="py-3 px-3 text-center">Last Updated</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {paginatedCompanies.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-slate-500">
                    No company master records matching current filters.
                  </td>
                </tr>
              ) : (
                paginatedCompanies.map((comp) => {
                  const idInfo = getCompanyExternalId(comp);
                  const isMissing = !idInfo.has_required_id;
                  const isHaulier = idInfo.category === 'HAULIER';
                  const isForwarder = idInfo.category === 'FORWARDING';

                  return (
                    <tr
                      key={comp.id}
                      className="hover:bg-slate-50/70 transition-colors"
                    >
                      <td className="py-3 px-4">
                        <div className="font-bold text-slate-900">{comp.name.toUpperCase()}</div>
                      </td>

                      <td className="py-3 px-3 text-center font-mono text-[11px] text-slate-600">
                        {comp.registration_number_old || comp.registration_number || '—'}
                      </td>

                      <td className="py-3 px-3 text-center font-mono text-[11px] text-slate-600">
                        {comp.registration_number_new || '—'}
                      </td>

                      <td className="py-3 px-3 text-center text-slate-700">
                        {comp.company_type}
                      </td>

                      <td className="py-3 px-4 font-mono text-slate-700">
                        <div className="flex flex-wrap items-center gap-1.5">
                          {(isHaulier || comp.haulier_id) && (
                            comp.haulier_id ? (
                              <span title="Haulier ID">{comp.haulier_id}</span>
                            ) : (
                              <button
                                type="button"
                                onClick={() => setSelectedCompanyForId(comp)}
                                className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-700 hover:bg-amber-100"
                                title="Assign Haulier ID"
                              >
                                Haulier ID Required
                              </button>
                            )
                          )}

                          {(isForwarder || comp.forwarding_agent_id) && (
                            comp.forwarding_agent_id ? (
                              <span title="Forwarding Agent ID">{comp.forwarding_agent_id}</span>
                            ) : (
                              <button
                                type="button"
                                onClick={() => setSelectedCompanyForId(comp)}
                                className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-700 hover:bg-amber-100"
                                title="Assign Forwarder ID"
                              >
                                Forwarder ID Required
                              </button>
                            )
                          )}

                          {!comp.haulier_id && !comp.forwarding_agent_id && !isHaulier && !isForwarder && (
                            <button
                              type="button"
                              onClick={() => setSelectedCompanyForId(comp)}
                              className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-700 hover:bg-amber-100"
                            >
                              ID Required
                            </button>
                          )}
                        </div>
                      </td>

                      <td className="py-3 px-3 text-center text-[11px] text-slate-600">
                        {(comp.assigned_port_ids?.length ? comp.assigned_port_ids : comp.port_id ? [comp.port_id] : [])
                          .map((portId) => ports.find((port) => port.id === portId)?.display_name)
                          .filter(Boolean)
                          .join(', ') || 'Unassigned'}
                      </td>

                      <td className="py-3 px-3 text-center text-[11px] text-slate-400">
                        {formatAdminDate(comp.updated_at)}
                      </td>

                      <td className="py-3 px-4 text-right">
                        <CompanyActionMenu
                          companyName={comp.name}
                          isOpen={activeActionMenuId === comp.id}
                          onToggle={() => setActiveActionMenuId(activeActionMenuId === comp.id ? null : comp.id)}
                          onClose={() => setActiveActionMenuId(null)}
                          onAssignId={() => {
                            setActiveActionMenuId(null);
                            setSelectedCompanyForId(comp);
                          }}
                          onEdit={() => {
                            setActiveActionMenuId(null);
                            setEditingCompany(comp);
                            setIsNewCompanyModalOpen(true);
                          }}
                        />
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        <div className="flex flex-col gap-3 border-t border-slate-200 bg-slate-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3 text-xs text-slate-500">
            <span>
              {sortedCompanies.length
                ? `Showing ${pageStart + 1}-${Math.min(pageStart + pageSize, sortedCompanies.length)} of ${sortedCompanies.length}`
                : 'Showing 0 companies'}
            </span>
            <label className="flex items-center gap-2">
              <span>Show</span>
              <select
                value={pageSize}
                onChange={(event) => setPageSize(Number(event.target.value))}
                className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 focus:border-slate-400 focus:outline-none"
                aria-label="Companies per page"
              >
                {PAGE_SIZE_OPTIONS.map((size) => <option key={size} value={size}>{size}</option>)}
              </select>
            </label>
          </div>

          <nav className="flex items-center gap-1" aria-label="Company table pagination">
            <button
              type="button"
              onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
              disabled={safeCurrentPage === 1}
              aria-label="Previous page"
              title="Previous page"
              className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-600 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <ChevronLeft className="h-4 w-4" />
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
              <ChevronRight className="h-4 w-4" />
            </button>
          </nav>
        </div>
      </div>

      {/* Assign ID Modal */}
      <AssignIdModal
        company={selectedCompanyForId}
        isOpen={!!selectedCompanyForId}
        onClose={() => setSelectedCompanyForId(null)}
        onSuccess={refreshList}
      />

      {/* Add / Edit Company Modal */}
      {isNewCompanyModalOpen && (
        <CompanyEditModal
          company={editingCompany}
          onClose={() => setIsNewCompanyModalOpen(false)}
          onSuccess={() => {
            setIsNewCompanyModalOpen(false);
            refreshList();
          }}
        />
      )}
    </div>
  );
}

function getVisiblePageNumbers(currentPage: number, totalPages: number): number[] {
  const visibleCount = Math.min(5, totalPages);
  const start = Math.min(
    Math.max(1, currentPage - Math.floor(visibleCount / 2)),
    totalPages - visibleCount + 1,
  );
  return Array.from({ length: visibleCount }, (_, index) => start + index);
}

function CompanyActionMenu({
  companyName,
  isOpen,
  onToggle,
  onClose,
  onAssignId,
  onEdit,
}: {
  companyName: string;
  isOpen: boolean;
  onToggle: () => void;
  onClose: () => void;
  onAssignId: () => void;
  onEdit: () => void;
}) {
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState({ top: -9999, left: -9999 });

  useLayoutEffect(() => {
    if (!isOpen || !triggerRef.current || !menuRef.current) return;

    const triggerRect = triggerRef.current.getBoundingClientRect();
    const menuRect = menuRef.current.getBoundingClientRect();
    const viewportPadding = 8;
    const gap = 4;
    const belowTop = triggerRect.bottom + gap;
    const top = belowTop + menuRect.height <= window.innerHeight - viewportPadding
      ? belowTop
      : Math.max(viewportPadding, triggerRect.top - menuRect.height - gap);
    const left = Math.min(
      Math.max(viewportPadding, triggerRect.right - menuRect.width),
      window.innerWidth - menuRect.width - viewportPadding,
    );

    setPosition({ top, left });
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    const closeMenu = () => onClose();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('resize', closeMenu);
    window.addEventListener('scroll', closeMenu, true);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('resize', closeMenu);
      window.removeEventListener('scroll', closeMenu, true);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose]);

  const popup = isOpen && typeof document !== 'undefined'
    ? createPortal(
      <>
        <button type="button" tabIndex={-1} aria-label="Close actions" className="fixed inset-0 z-[70] h-full w-full cursor-default bg-transparent" onClick={onClose} />
        <div
          ref={menuRef}
          role="menu"
          style={{ top: position.top, left: position.left }}
          className="fixed z-[80] w-48 rounded-lg border border-slate-200 bg-white py-1 text-left shadow-xl"
        >
          <button type="button" role="menuitem" onClick={onAssignId} className="flex w-full items-center gap-2.5 px-3 py-2 text-xs font-semibold text-slate-700 transition-colors hover:bg-blue-50 hover:text-blue-700">
            <Key className="h-3.5 w-3.5 text-blue-600" /> Assign / Edit ID
          </button>
          <button type="button" role="menuitem" onClick={onEdit} className="flex w-full items-center gap-2.5 px-3 py-2 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50 hover:text-slate-900">
            <Edit2 className="h-3.5 w-3.5 text-slate-500" /> Edit Company Details
          </button>
        </div>
      </>,
      document.body,
    )
    : null;

  return (
    <div className="relative inline-block text-left">
      <button
        ref={triggerRef}
        type="button"
        onClick={onToggle}
        aria-label={`Actions for ${companyName}`}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        title="Actions"
        className={`rounded-lg p-1.5 transition-colors focus:outline-none ${isOpen ? 'bg-slate-200 text-slate-900' : 'text-slate-500 hover:bg-slate-100 hover:text-slate-900'}`}
      >
        <MoreVertical className="h-4 w-4" />
      </button>
      {popup}
    </div>
  );
}

function CompanyEditModal({
  company,
  onClose,
  onSuccess,
}: {
  company: Company | null;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const ports = getPorts();
  const depots = getDepots();
  const sortedPorts = [...ports].sort((left, right) => String(left.display_name || '').localeCompare(String(right.display_name || '')));

  const [activeSection, setActiveSection] = useState(0);
  const [isSaving, setIsSaving] = useState(false);
  const [isImportMenuOpen, setIsImportMenuOpen] = useState(false);
  const [isJsonImportOpen, setIsJsonImportOpen] = useState(false);
  const [jsonImport, setJsonImport] = useState('');
  const [importError, setImportError] = useState('');
  const importFileRef = useRef<HTMLInputElement | null>(null);
  const importMenuRef = useRef<HTMLDivElement | null>(null);
  const [form, setForm] = useState<CompanyFormState>({
    id: company?.id || '',
    name: company?.name || '',
    short_name: company?.short_name || '',
    company_type: normalizeCompanyType(company?.company_type),
    registration_number: company?.registration_number_old || company?.registration_number || '',
    registration_number_old: company?.registration_number_old || company?.registration_number || '',
    registration_number_new: company?.registration_number_new || '',
    haulier_id: company?.haulier_id || '',
    forwarding_agent_id: company?.forwarding_agent_id || '',
    port_id: company?.port_id || ports[0]?.id || '',
    depot_id: company?.depot_id || '',
    assigned_port_ids: company?.assigned_port_ids || (company?.port_id ? [company.port_id] : []),
    assigned_depot_ids: company?.assigned_depot_ids || (company?.depot_id ? [company.depot_id] : []),
    block: company?.block || '',
    address1: company?.address1 || '',
    address2: company?.address2 || '',
    city: company?.city || '',
    state: company?.state || COMPANY_STATES_BY_COUNTRY[normalizeCompanyCountry(company?.country || 'Malaysia')][0],
    postcode: company?.postcode || '',
    country: normalizeCompanyCountry(company?.country || 'Malaysia'),
    contact_name: company?.contact_name || '',
    contact_email: company?.contact_email || '',
    contact_designation: company?.contact_designation || '',
    contact_mobile: company?.contact_mobile || '',
    office_phone: company?.office_phone || '',
    fax: company?.fax || '',
    status: company?.status || 'ACTIVE',
  });

  const selectedPortIds = Array.isArray(form.assigned_port_ids) ? form.assigned_port_ids : [];
  const sortedDepotOptions = selectedPortIds
    .map((portId) => ports.find((port) => port.id === portId))
    .filter((port): port is typeof ports[number] => !!port)
    .sort((left, right) => String(left.display_name || '').localeCompare(String(right.display_name || '')))
    .flatMap((port) => depots
      .filter((depot) => depot.port_id === port.id)
      .sort((left, right) => String(left.display_name || '').localeCompare(String(right.display_name || '')))
      .map((depot) => ({ value: depot.id, label: depot.display_name, group: port.display_name })));

  const sections = [
    { title: 'Identity & Registration', description: 'Company identity and statutory registration details.' },
    { title: 'Operations & IDs', description: 'Port and depot assignments with external account identifiers.' },
    { title: 'Registered Address', description: 'Registered company address and location details.' },
    { title: 'Contact Details', description: 'Primary operational contact and communication details.' },
  ];

  const setField = <K extends keyof CompanyFormState>(field: K, value: CompanyFormState[K]) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  const isEditing = !!company;

  useEffect(() => {
    if (!isImportMenuOpen) return;
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!importMenuRef.current?.contains(event.target as Node)) setIsImportMenuOpen(false);
    };
    document.addEventListener('mousedown', closeOnOutsideClick);
    return () => document.removeEventListener('mousedown', closeOnOutsideClick);
  }, [isImportMenuOpen]);

  const applyImportedRecord = (record: Record<string, unknown>) => {
    const normalized = Object.entries(record).reduce<Record<string, unknown>>((result, [key, value]) => {
      result[normalizeImportKey(key)] = value;
      return result;
    }, {});
    const readPath = (path: string): unknown => {
      return path.split('.').reduce<unknown>((current, segment) => {
        if (!current || typeof current !== 'object' || Array.isArray(current)) return undefined;
        const entry = Object.entries(current as Record<string, unknown>).find(([key]) => normalizeImportKey(key) === normalizeImportKey(segment));
        return entry?.[1];
      }, record);
    };
    const scalarValue = (value: unknown): string | undefined => {
      if (value === undefined || value === null || typeof value === 'object') return undefined;
      return String(value).trim();
    };
    const valueFor = (...keys: string[]) => {
      for (const key of keys) {
        const value = scalarValue(readPath(key));
        if (value !== undefined) return value;
        const topLevelValue = scalarValue(normalized[normalizeImportKey(key)]);
        if (topLevelValue !== undefined) return topLevelValue;
      }
      return undefined;
    };
    const resolveList = (raw: string | undefined, kind: 'port' | 'depot') => {
      if (!raw) return undefined;
      const values = raw.split(/[,;|]/).map((item) => item.trim()).filter(Boolean);
      const options = kind === 'port' ? ports : depots;
      return values.map((item) => options.find((option) => option.id.toLowerCase() === item.toLowerCase() || option.display_name.toLowerCase() === item.toLowerCase() || ('code' in option && option.code.toLowerCase() === item.toLowerCase()))?.id || item);
    };

    const imported: Partial<CompanyFormState> = {};
    const setImported = (field: keyof CompanyFormState, ...keys: string[]) => {
      const value = valueFor(...keys);
      if (value !== undefined) imported[field] = value as never;
    };
    setImported('name', 'name', 'company name', 'company legal name', 'company full legal name');
    setImported('short_name', 'short name', 'shortname', 'company short name', 'trade name');
    const importedType = valueFor('type', 'company type', 'company category');
    if (importedType) imported.company_type = normalizeCompanyType(importedType);
    setImported('registration_number_old', 'registration', 'ids.registration', 'registration old', 'old registration number', 'company registration number');
    setImported('registration_number_new', 'registration new', 'new registration number', 'ssm number');
    setImported('haulier_id', 'haulierid', 'haulier id', 'haulier', 'ids.haulier');
    setImported('forwarding_agent_id', 'forwarding agent id', 'forwarding agent_id', 'ids.forwarding_agent_id', 'ids.forwardingagentid');
    setImported('block', 'block', 'address.block', 'building block floor lot');
    setImported('address1', 'address1', 'address.address1', 'address line 1');
    setImported('address2', 'address2', 'address.address2', 'address line 2');
    setImported('city', 'city', 'address.city', 'city town');
    setImported('state', 'state', 'address.state', 'state region');
    setImported('postcode', 'postcode', 'address.postcode', 'postal code');
    const importedCountry = valueFor('country', 'address.country');
    if (importedCountry) {
      imported.country = normalizeCompanyCountry(importedCountry);
    }
    if (imported.state) {
      const stateOptions = COMPANY_STATES_BY_COUNTRY[normalizeCompanyCountry(String(imported.country || form.country || 'Malaysia'))] || [];
      imported.state = stateOptions.find((state) => state.toLowerCase() === String(imported.state).toLowerCase()) || imported.state;
    }
    setImported('contact_name', 'contact name', 'contact.name', 'contact person', 'contact person name');
    setImported('contact_email', 'contact email', 'contact.email', 'email', 'email address');
    setImported('contact_designation', 'contact designation', 'contact.designation', 'designation', 'job designation');
    setImported('contact_mobile', 'contact mobile', 'contact.mobile', 'mobile', 'mobile number');
    setImported('office_phone', 'office', 'phone.office', 'office phone');
    setImported('fax', 'fax', 'phone.fax', 'fax number');

    const listValue = (...paths: string[]) => paths.map((path) => readPath(path)).find((value) => value !== undefined);
    const portCodes = listValue('portcodes', 'ids.portcodes');
    const portCodeValue = Array.isArray(portCodes) ? portCodes.flat(Infinity).map((value) => String(value)).join(',') : scalarValue(portCodes);
    const depotObject = readPath('depots');
    const depotKeys = depotObject && typeof depotObject === 'object' && !Array.isArray(depotObject) ? Object.keys(depotObject).join(',') : undefined;
    const portsValue = resolveList(valueFor('ports', 'port', 'port id', 'assigned ports') || portCodeValue || valueFor('ids.portcodes'), 'port');
    const depotsValue = resolveList(valueFor('depot', 'depot id', 'assigned depots') || depotKeys, 'depot');
    setForm((current) => ({
      ...current,
      ...imported,
      registration_number: (imported.registration_number_old as string) || current.registration_number,
      assigned_port_ids: portsValue || current.assigned_port_ids,
      assigned_depot_ids: depotsValue || current.assigned_depot_ids,
      port_id: portsValue?.[0] || current.port_id,
      depot_id: depotsValue?.[0] || current.depot_id,
      state: imported.state || current.state,
    }));
    setImportError('');
    setIsJsonImportOpen(false);
    setIsImportMenuOpen(false);
    notifySuccess('Company details imported into the form.');
  };

  const handleJsonImport = () => {
    try {
      const parsed = JSON.parse(jsonImport);
      const record = Array.isArray(parsed) ? parsed[0] : parsed;
      if (!record || typeof record !== 'object' || Array.isArray(record)) throw new Error('JSON must contain one company object.');
      applyImportedRecord(record as Record<string, unknown>);
    } catch (error) {
      const legacyRecord = parseLegacyCompanyPayload(jsonImport);
      if (legacyRecord) {
        applyImportedRecord(legacyRecord);
      } else {
        setImportError(error instanceof Error ? `${error.message} Paste JSON or PHP Object output containing company details.` : 'Unable to read this company payload.');
      }
    }
  };

  const handleExcelImport = async (file: File) => {
    try {
      const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });
      if (!rows.length) throw new Error('The Excel file does not contain a data row.');
      applyImportedRecord(rows[0]);
    } catch (error) {
      setImportError(error instanceof Error ? error.message : 'Unable to read this Excel file.');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const oldRegistrationNumber = form.registration_number_old?.trim() || '';
    if (!form.name.trim() || !oldRegistrationNumber) {
      const message = 'Company Name and Old Registration Number are required.';
      notifyWarning(message);
      return;
    }

    // Duplicate check if new or changed
    if (checkDuplicateRegNo(oldRegistrationNumber, company?.id)) {
      const message = `A company with registration number "${oldRegistrationNumber}" already exists in Master!`;
      notifyWarning(message);
      return;
    }

    setIsSaving(true);
    try {
      await saveCompanyPersisted({
        id: company?.id,
        name: form.name.trim().toUpperCase(),
        short_name: form.short_name.trim().toUpperCase(),
        company_type: form.company_type,
        registration_number: oldRegistrationNumber.toUpperCase(),
        registration_number_old: oldRegistrationNumber.toUpperCase(),
        registration_number_new: form.registration_number_new.trim().toUpperCase(),
        haulier_id: form.haulier_id.trim().toUpperCase(),
        forwarding_agent_id: form.forwarding_agent_id.trim().toUpperCase(),
        port_id: form.assigned_port_ids?.[0] || '',
        depot_id: form.assigned_depot_ids?.[0] || '',
        assigned_port_ids: form.assigned_port_ids || [],
        assigned_depot_ids: form.assigned_depot_ids || [],
        block: form.block.trim(),
        address1: form.address1.trim(),
        address2: form.address2.trim(),
        city: form.city.trim(),
        state: form.state.trim(),
        postcode: form.postcode.trim(),
        country: form.country.trim(),
        contact_name: form.contact_name.trim(),
        contact_email: form.contact_email.trim(),
        contact_designation: form.contact_designation.trim(),
        contact_mobile: form.contact_mobile.trim(),
        office_phone: form.office_phone.trim(),
        fax: form.fax.trim(),
        status: form.status,
      });

      notifySuccess(isEditing ? 'Company updated successfully.' : 'Company added successfully.');
      onSuccess();
    } catch (error) {
      notifyError(error instanceof Error ? error.message : 'Unable to save the company. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs">
      <div className="flex h-[min(760px,calc(100vh-2rem))] min-w-0 w-[min(900px,calc(100vw-2rem))] max-w-full flex-col overflow-hidden rounded-2xl border border-slate-100 bg-white p-6 shadow-2xl">
        <div className="flex min-w-0 items-center justify-between pb-4 border-b border-slate-100">
          <div>
            <h3 className="text-base font-bold text-slate-900">{isEditing ? 'Edit Master Company' : 'Add New Master Company'}</h3>
            <p className="mt-1 text-[11px] text-slate-500">Complete the four sections or import a company record.</p>
          </div>
          <div ref={importMenuRef} className="relative flex items-center gap-1">
            <button type="button" onClick={() => setIsImportMenuOpen((open) => !open)} aria-label="Import company data" title="Import company data" className={`rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-900 ${isImportMenuOpen ? 'bg-slate-100 text-slate-900' : ''}`}>
              <MoreVertical className="h-5 w-5" />
            </button>
            {isImportMenuOpen && (
              <div className="absolute right-8 top-0 z-10 w-52 rounded-lg border border-slate-200 bg-white py-1 text-left shadow-xl">
                <button type="button" onClick={() => { setIsJsonImportOpen(true); setIsImportMenuOpen(false); setImportError(''); }} className="flex w-full items-center gap-2 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-blue-50 hover:text-blue-700"><ClipboardPaste className="h-4 w-4" /> Paste JSON</button>
                <button type="button" onClick={() => importFileRef.current?.click()} className="flex w-full items-center gap-2 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-blue-50 hover:text-blue-700"><FileSpreadsheet className="h-4 w-4" /> Upload Excel file</button>
              </div>
            )}
            <input ref={importFileRef} type="file" accept=".xlsx,.xls,.xlsm" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) void handleExcelImport(file); event.target.value = ''; }} />
            <button type="button" onClick={onClose} className="rounded-lg p-1 text-slate-400 hover:text-slate-600"><X className="h-5 w-5" /></button>
          </div>
        </div>

        {isJsonImportOpen ? (
          <div className="mt-5 flex min-h-0 flex-1 flex-col rounded-xl border border-blue-100 bg-blue-50/60 p-4">
            <div className="mb-3">
              <h4 className="text-sm font-bold text-blue-900">Paste company data from Cargomove</h4>
              <p className="mt-1 text-[11px] text-blue-700">Paste JSON or PHP Object output, then confirm to fill the form. Only the {COMPANY_IMPORT_COLUMNS.length} supported Company Master columns are imported; all other details are ignored.</p>
            </div>
            <textarea autoFocus value={jsonImport} onChange={(event) => setJsonImport(event.target.value)} placeholder={'{"name":"Example Sdn Bhd","registration_number_old":"AAAAAA-2","contact_email":"ops@example.com"}'} className="min-h-0 flex-1 w-full resize-none rounded-lg border border-blue-200 bg-white p-3 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-blue-500" />
            {importError && <p className="mt-2 text-[11px] text-rose-600" role="alert">{importError}</p>}
            <div className="mt-3 flex justify-end gap-2">
              <button type="button" onClick={() => { setIsJsonImportOpen(false); setImportError(''); }} className="rounded-lg px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-white">Cancel</button>
              <button type="button" onClick={handleJsonImport} className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-xs font-bold text-white hover:bg-blue-700"><ClipboardPaste className="h-3.5 w-3.5" /> Confirm data</button>
            </div>
          </div>
        ) : <>
          <div className="mt-4 flex min-w-0 items-center gap-2" role="tablist" aria-label="Company details sections">
            {sections.map((section, index) => (
              <button
                key={section.title}
                type="button"
                role="tab"
                aria-selected={activeSection === index}
                onClick={() => setActiveSection(index)}
                className={`min-w-0 flex-1 border-b-2 px-2 pb-2 text-left transition-colors ${
                  activeSection === index ? 'border-blue-600 text-blue-700' : 'border-slate-200 text-slate-400 hover:text-slate-600'
                }`}
              >
                <span className="block text-[10px] font-bold uppercase tracking-wider">Section {index + 1}</span>
                <span className="block truncate text-xs font-normal">{section.title}</span>
              </button>
            ))}
          </div>

          <form onSubmit={handleSubmit} className="mt-5 flex min-h-0 min-w-0 w-full flex-1 flex-col space-y-4 text-xs">
            <p className="min-w-0 break-words text-[10px] font-normal text-slate-500">{sections[activeSection].description}</p>
            {importError && <p className="rounded-lg border border-rose-100 bg-rose-50 px-3 py-2 text-[11px] text-rose-700" role="alert">{importError}</p>}
            <div className="min-h-0 flex-1 overflow-y-auto overflow-x-visible px-1">
            {activeSection === 0 && (
              <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="Company Legal Name *" value={form.name} onChange={(value) => setField('name', value.toUpperCase())} className="uppercase sm:col-span-2" placeholder="LUMORA TECH SDN BHD" />
                <Field label="Short Name" value={form.short_name} onChange={(value) => setField('short_name', value.toUpperCase())} className="uppercase" placeholder="LUMORA" />
                <SelectField label="Company Category *" value={form.company_type} onChange={(value) => setField('company_type', value)} options={['FORWARDER', 'HAULAGE', 'TRANSPORT']} />
                <Field label="Old Registration No *" value={form.registration_number_old || ''} onChange={(value) => { setField('registration_number_old', value); setField('registration_number', value); }} className="font-mono" placeholder="AAAAAA-2" />
                <Field label="SSM New 12-Digit Reg No" value={form.registration_number_new || ''} onChange={(value) => setField('registration_number_new', value)} className="font-mono" placeholder="201901004521" />
              </div>
            )}

            {activeSection === 1 && (
              <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="HAULIERID" value={form.haulier_id || ''} onChange={(value) => setField('haulier_id', value)} className="font-mono" placeholder="xyz456" />
                <Field label="FORWARDING_AGENT_ID" value={form.forwarding_agent_id || ''} onChange={(value) => setField('forwarding_agent_id', value)} className="font-mono" placeholder="64abc123xyz" />
                <AssignmentField
                  label="Assign to Ports"
                  options={sortedPorts.map((port) => ({ value: port.id, label: `${port.display_name} (${port.location})` }))}
                  values={form.assigned_port_ids || []}
                  onChange={(values) => {
                    const validDepotIds = (form.assigned_depot_ids || []).filter((depotId) => {
                      const depot = depots.find((item) => item.id === depotId);
                      return depot && values.includes(depot.port_id);
                    });
                    setForm((current) => ({ ...current, assigned_port_ids: values, assigned_depot_ids: validDepotIds, port_id: values[0] || '', depot_id: validDepotIds[0] || '' }));
                  }}
                />
                <AssignmentField
                  label="Assign to Depots"
                  options={sortedDepotOptions}
                  values={form.assigned_depot_ids || []}
                  onChange={(values) => setForm((current) => ({ ...current, assigned_depot_ids: values, depot_id: values[0] || '' }))}
                  emptyMessage={(form.assigned_port_ids || []).length ? 'No depots configured for the selected ports.' : 'Select at least one port first.'}
                />
              </div>
            )}

            {activeSection === 2 && (
              <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="Block / Building" value={form.block || ''} onChange={(value) => setField('block', value)} />
                <SelectField label="Country" value={normalizeCompanyCountry(form.country)} onChange={(value) => setForm((current) => ({ ...current, country: value, state: COMPANY_STATES_BY_COUNTRY[value]?.[0] || '' }))} options={Object.keys(COMPANY_STATES_BY_COUNTRY)} />
                <Field label="Address Line 1" value={form.address1 || ''} onChange={(value) => setField('address1', value)} className="sm:col-span-2" />
                <Field label="Address Line 2" value={form.address2 || ''} onChange={(value) => setField('address2', value)} className="sm:col-span-2" />
                <Field label="City" value={form.city || ''} onChange={(value) => setField('city', value)} />
                <SelectField label="State / Region" value={form.state || ''} onChange={(value) => setField('state', value)} options={COMPANY_STATES_BY_COUNTRY[normalizeCompanyCountry(form.country)] || []} />
                <Field label="Postcode" value={form.postcode || ''} onChange={(value) => setField('postcode', value)} />
              </div>
            )}

            {activeSection === 3 && (
              <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="Contact Person" value={form.contact_name || ''} onChange={(value) => setField('contact_name', value)} />
                <Field label="Contact Designation" value={form.contact_designation || ''} onChange={(value) => setField('contact_designation', value)} />
                <Field label="Contact Email" type="email" value={form.contact_email || ''} onChange={(value) => setField('contact_email', value)} />
                <Field label="Contact Mobile" value={form.contact_mobile || ''} onChange={(value) => setField('contact_mobile', value)} />
                <Field label="Office Phone" value={form.office_phone || ''} onChange={(value) => setField('office_phone', value)} />
                <Field label="Fax" value={form.fax || ''} onChange={(value) => setField('fax', value)} />
              </div>
            )}
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-slate-100 pt-4">
            <button type="button" onClick={onClose} className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg">Cancel</button>
            {activeSection > 0 && (
              <button type="button" onClick={() => setActiveSection((section) => section - 1)} className="inline-flex items-center gap-1 px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg">
                <ChevronLeft className="w-3.5 h-3.5" /> Back
              </button>
            )}
            {activeSection < sections.length - 1 ? (
              <button type="button" onClick={() => setActiveSection((section) => section + 1)} className="inline-flex items-center gap-1 px-4 py-2 text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-lg font-semibold">
                Next <ChevronRight className="w-3.5 h-3.5" />
              </button>
            ) : (
              <button type="submit" disabled={isSaving} className="px-5 py-2 bg-blue-600 hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60 text-white font-bold rounded-lg shadow-sm">
                {isSaving ? 'Saving...' : isEditing ? 'Save Changes' : 'Create Master Company'}
              </button>
            )}
            </div>
          </form>
        </>}

      </div>
    </div>
  );
}

type CompanyFormState = Omit<Company, 'created_at' | 'updated_at'>;

const COMPANY_IMPORT_COLUMNS = [
  'HAULIERID', 'FORWARDING_AGENT_ID', 'NAME', 'SHORTNAME', 'TYPE', 'REGISTRATION', 'REGISTRATION_NEW',
  'PORTS', 'DEPOTS', 'BLOCK', 'ADDRESS1', 'ADDRESS2', 'CITY', 'STATE', 'POSTCODE', 'COUNTRY',
  'CONTACTNAME', 'CONTACTEMAIL', 'CONTACTDESGN', 'CONTACTMOBILE', 'OFFICE', 'FAX',
] as const;

function normalizeImportKey(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}

function normalizeCompanyCountry(value?: string): string {
  const normalized = String(value || 'Malaysia').trim().toLowerCase();
  if (normalized === 'my' || normalized === 'malaysia') return 'Malaysia';
  if (normalized === 'sg' || normalized === 'singapore') return 'Singapore';
  return Object.keys(COMPANY_STATES_BY_COUNTRY).find((country) => country.toLowerCase() === normalized) || 'Malaysia';
}

/** Reads the PHP print_r/var_dump style payload often copied from the source system. */
function parseLegacyCompanyPayload(payload: string): Record<string, unknown> | null {
  if (!/(stdClass\s+Object|\[[^\]]+\]\s*=>)/i.test(payload)) return null;

  const valuesFor = (field: string): string[] => {
    const expression = new RegExp(`^\\s*\\[${field.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}\\]\\s*=>\\s*(.+?)\\s*$`, 'gim');
    return Array.from(payload.matchAll(expression))
      .map((match) => match[1].trim())
      .filter((value) => value && !/^(stdClass Object|Array|NULL)$/i.test(value));
  };
  const first = (...fields: string[]) => fields.flatMap(valuesFor)[0];
  const values = (field: string) => valuesFor(field);
  const record: Record<string, unknown> = {};

  const name = first('name');
  const shortName = first('shortname', 'short_name');
  const type = first('type');
  const registration = first('registration');
  const haulier = first('haulier');
  if (name) record.name = name;
  if (shortName) record.shortname = shortName;
  if (type) record.type = type;
  if (registration) record.registration = registration;
  if (haulier) record.haulier = haulier;

  const addressFields = ['block', 'address1', 'address2', 'city', 'state', 'postcode', 'country'];
  addressFields.forEach((field) => {
    const value = first(field);
    if (value) record[`address.${field}`] = value;
  });

  const contactName = values('name')[1];
  const contactEmail = first('email');
  const contactDesignation = first('designation');
  const contactMobile = first('mobile');
  const office = first('office');
  const fax = first('fax');
  if (contactName) record['contact.name'] = contactName;
  if (contactEmail) record['contact.email'] = contactEmail;
  if (contactDesignation) record['contact.designation'] = contactDesignation;
  if (contactMobile) record['contact.mobile'] = contactMobile;
  if (office) record['phone.office'] = office;
  if (fax) record['phone.fax'] = fax;

  const portcodesStart = payload.search(/^\s*\[portcodes\]\s*=>/im);
  if (portcodesStart >= 0) {
    const portcodesPayload = payload.slice(portcodesStart).split(/^\s*\[(?:depots|name|address|contact|phone|type|t)\]\s*=>/im)[0];
    const portcodes = Array.from(portcodesPayload.matchAll(/^\s*\[\d+\]\s*=>\s*([^\r\n]+)$/gim)).map((match) => match[1].trim()).filter((value) => value && !/^(Array|stdClass Object)$/i.test(value));
    if (portcodes.length) record.portcodes = portcodes;
  }

  const depotsStart = payload.search(/^\s*\[depots\]\s*=>/im);
  if (depotsStart >= 0) {
    const depotPayload = payload.slice(depotsStart);
    const depotKeys = Array.from(depotPayload.matchAll(/^\s*\[([a-f0-9]{12,})\]\s*=>\s*stdClass Object/gim)).map((match) => match[1]);
    if (depotKeys.length) record.depots = Object.fromEntries(depotKeys.map((key) => [key, {}]));
  }

  return Object.keys(record).length ? record : null;
}

function Field({
  label,
  value,
  onChange,
  className = '',
  placeholder,
  type = 'text',
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  className?: string;
  placeholder?: string;
  type?: string;
}) {
  return (
    <label className={`block min-w-0 w-full overflow-visible ${className}`}>
      <span className="block font-semibold text-slate-700 mb-1">{label}</span>
      <input type={type} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} className="box-border block w-full max-w-full min-w-0 px-3 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-blue-500 focus:outline-none" />
    </label>
  );
}

function SelectField({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<string | { value: string; label: string }>;
}) {
  return (
    <label className="block min-w-0 w-full overflow-visible">
      <span className="block font-semibold text-slate-700 mb-1">{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)} className="box-border block w-full max-w-full min-w-0 px-3 py-2 rounded-lg border border-slate-300 bg-white focus:ring-2 focus:ring-blue-500 focus:outline-none">
        {options.map((option) => {
          const normalized = typeof option === 'string' ? { value: option, label: option } : option;
          return <option key={normalized.value} value={normalized.value}>{normalized.label}</option>;
        })}
      </select>
    </label>
  );
}

function AssignmentField({
  label,
  options,
  values,
  onChange,
  emptyMessage = 'No options available.',
}: {
  label: string;
  options: Array<{ value: string; label: string; group?: string }>;
  values: string[];
  onChange: (values: string[]) => void;
  emptyMessage?: string;
}) {
  const toggleValue = (value: string) => {
    onChange(values.includes(value)
      ? values.filter((current) => current !== value)
      : [...values, value]);
  };

  return (
    <fieldset className="rounded-lg border border-slate-200 p-3">
      <legend className="px-1 font-semibold text-slate-700">{label}</legend>
      <div className="grid min-h-[116px] grid-cols-1 content-start gap-1">
        {options.length ? options.map((option, index) => (
          <React.Fragment key={option.value}>
            {option.group && option.group !== options[index - 1]?.group && (
              <p className="col-span-1 border-b border-slate-100 px-2 pb-1 pt-2 text-[10px] font-bold uppercase tracking-wide text-slate-500 first:pt-0">{option.group}</p>
            )}
            <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-slate-700 hover:bg-slate-50">
              <input
                type="checkbox"
                checked={values.includes(option.value)}
                onChange={() => toggleValue(option.value)}
                className="h-3.5 w-3.5 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
              />
              <span>{option.label}</span>
            </label>
          </React.Fragment>
        )) : <p className="px-2 py-1.5 text-[11px] text-slate-400">{emptyMessage}</p>}
      </div>
    </fieldset>
  );
}
