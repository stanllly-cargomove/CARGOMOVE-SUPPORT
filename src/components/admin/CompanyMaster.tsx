import React, { useEffect, useState } from 'react';
import { Company } from '../../types';
import {
  getCompanies,
  saveCompany,
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
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { notifySuccess, notifyWarning } from '../common/notifications';

export function CompanyMaster() {
  const [companies, setCompanies] = useState<Company[]>(getCompanies());
  const [searchTerm, setSearchTerm] = useState('');
  const [typeFilter, setTypeFilter] = useState('ALL');
  const [portFilter, setPortFilter] = useState('ALL');
  const [missingIdOnly, setMissingIdOnly] = useState(false);

  // Modals
  const [selectedCompanyForId, setSelectedCompanyForId] = useState<Company | null>(null);
  const [isNewCompanyModalOpen, setIsNewCompanyModalOpen] = useState(false);
  const [editingCompany, setEditingCompany] = useState<Company | null>(null);
  const [activeActionMenuId, setActiveActionMenuId] = useState<string | null>(null);

  const ports = getPorts();

  const refreshList = () => {
    setCompanies(getCompanies());
  };

  useEffect(() => subscribeToStorage(refreshList), []);

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
    const matchesPort = portFilter === 'ALL' || comp.port_id === portFilter;

    // Missing ID filter
    const idInfo = getCompanyExternalId(comp);
    const matchesMissingId = !missingIdOnly || !idInfo.has_required_id;

    return matchesSearch && matchesType && matchesPort && matchesMissingId;
  });

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
          Add Master Company
        </button>
      </div>

      {/* Filter and Search Bar */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-col md:flex-row items-center gap-3">
        <div className="relative flex-1 w-full">
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search by Registration No (AAAAAA-2) or Company Name..."
            className="w-full px-3.5 py-2 pl-9 rounded-lg border border-slate-300 text-xs focus:ring-2 focus:ring-blue-500 focus:outline-none"
          />
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
        </div>

        <div className="flex items-center gap-2 w-full md:w-auto">
          {/* Company Type Filter */}
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="px-3 py-2 rounded-lg border border-slate-300 text-xs bg-white focus:ring-2 focus:ring-blue-500"
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
            className="px-3 py-2 rounded-lg border border-slate-300 text-xs bg-white focus:ring-2 focus:ring-blue-500"
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
            onClick={() => setMissingIdOnly(!missingIdOnly)}
            className={`px-3 py-2 rounded-lg text-xs font-bold border transition-colors whitespace-nowrap ${
              missingIdOnly
                ? 'bg-amber-100 text-amber-800 border-amber-300'
                : 'bg-slate-50 text-slate-600 border-slate-300 hover:bg-slate-100'
            }`}
          >
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
                <th className="py-3 px-3 text-center">Port</th>
                <th className="py-3 px-3 text-center">Last Updated</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredCompanies.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-slate-500">
                    No company master records matching current filters.
                  </td>
                </tr>
              ) : (
                filteredCompanies.map((comp) => {
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
                        <div className="font-bold text-slate-900">{comp.name}</div>
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
                                className="text-[11px] text-slate-600 underline hover:text-blue-700"
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
                                className="text-[11px] text-slate-600 underline hover:text-blue-700"
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
                              className="text-[11px] text-slate-600 underline hover:text-blue-700"
                            >
                              ID Required
                            </button>
                          )}
                        </div>
                      </td>

                      <td className="py-3 px-3 text-center text-[11px] text-slate-600">
                        {ports.find((p) => p.id === comp.port_id)?.location === 'JOHOR'
                          ? 'JOHOR DEPOT'
                          : 'PORT KLANG'}
                      </td>

                      <td className="py-3 px-3 text-center text-[11px] text-slate-400">
                        {new Date(comp.updated_at).toLocaleDateString()}
                      </td>

                      {/* 3-Dot Action Button & Dropdown Menu */}
                      <td className="py-3 px-4 text-right">
                        <div className="relative inline-block text-left">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setActiveActionMenuId(activeActionMenuId === comp.id ? null : comp.id);
                            }}
                            className={`p-1.5 rounded-lg transition-colors focus:outline-none ${
                              activeActionMenuId === comp.id
                                ? 'bg-slate-200 text-slate-900'
                                : 'text-slate-500 hover:text-slate-900 hover:bg-slate-100'
                            }`}
                            title="Actions"
                          >
                            <MoreVertical className="w-4 h-4" />
                          </button>

                          {activeActionMenuId === comp.id && (
                            <>
                              <div
                                className="fixed inset-0 z-40"
                                onClick={() => setActiveActionMenuId(null)}
                              />

                              <div className="absolute right-0 mt-1 w-48 rounded-lg bg-white border border-slate-200 shadow-xl py-1 z-50 text-left">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setActiveActionMenuId(null);
                                    setSelectedCompanyForId(comp);
                                  }}
                                  className="w-full flex items-center gap-2.5 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-blue-50 hover:text-blue-700 transition-colors"
                                >
                                  <Key className="w-3.5 h-3.5 text-blue-600" />
                                  Assign / Edit ID
                                </button>

                                <button
                                  type="button"
                                  onClick={() => {
                                    setActiveActionMenuId(null);
                                    setEditingCompany(comp);
                                    setIsNewCompanyModalOpen(true);
                                  }}
                                  className="w-full flex items-center gap-2.5 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 hover:text-slate-900 transition-colors"
                                >
                                  <Edit2 className="w-3.5 h-3.5 text-slate-500" />
                                  Edit Company Details
                                </button>

                              </div>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
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

  const [activeSection, setActiveSection] = useState(0);
  const [form, setForm] = useState<CompanyFormState>({
    id: company?.id || '',
    name: company?.name || '',
    short_name: company?.short_name || '',
    company_type: normalizeCompanyType(company?.company_type),
    registration_number: company?.registration_number || '',
    registration_number_old: company?.registration_number_old || '',
    registration_number_new: company?.registration_number_new || '',
    haulier_id: company?.haulier_id || '',
    forwarding_agent_id: company?.forwarding_agent_id || '',
    port_id: company?.port_id || ports[0]?.id || '',
    depot_id: company?.depot_id || '',
    block: company?.block || '',
    address1: company?.address1 || '',
    address2: company?.address2 || '',
    city: company?.city || '',
    state: company?.state || '',
    postcode: company?.postcode || '',
    country: company?.country || 'Malaysia',
    contact_name: company?.contact_name || '',
    contact_email: company?.contact_email || '',
    contact_designation: company?.contact_designation || '',
    contact_mobile: company?.contact_mobile || '',
    office_phone: company?.office_phone || '',
    fax: company?.fax || '',
    status: company?.status || 'ACTIVE',
  });

  const sections = [
    { title: 'Identity & Registration', description: 'Company identity and statutory registration details.' },
    { title: 'Operations & IDs', description: 'Port routing, account identifiers, and master status.' },
    { title: 'Address & Contact', description: 'Registered address and primary contact details.' },
  ];

  const setField = <K extends keyof CompanyFormState>(field: K, value: CompanyFormState[K]) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  const isEditing = !!company;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim() || !form.registration_number.trim()) {
      const message = 'Company Name and Registration Number are required.';
      notifyWarning(message);
      return;
    }

    // Duplicate check if new or changed
    if (checkDuplicateRegNo(form.registration_number, company?.id)) {
      const message = `A company with registration number "${form.registration_number}" already exists in Master!`;
      notifyWarning(message);
      return;
    }

    saveCompany({
      id: company?.id,
      name: form.name.trim().toUpperCase(),
      short_name: form.short_name.trim().toUpperCase(),
      company_type: form.company_type,
      registration_number: form.registration_number.trim().toUpperCase(),
      registration_number_old: form.registration_number_old.trim().toUpperCase(),
      registration_number_new: form.registration_number_new.trim().toUpperCase(),
      haulier_id: form.haulier_id.trim().toUpperCase(),
      forwarding_agent_id: form.forwarding_agent_id.trim().toUpperCase(),
      port_id: form.port_id,
      depot_id: form.depot_id,
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
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs">
      <div className="bg-white rounded-2xl max-w-xl w-full p-6 shadow-2xl border border-slate-100 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between pb-4 border-b border-slate-100">
          <h3 className="text-base font-bold text-slate-900">
            {isEditing ? 'Edit Master Company' : 'Add New Master Company'}
          </h3>
          <button onClick={onClose} className="p-1 text-slate-400 hover:text-slate-600 rounded-lg">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="mt-4 flex items-center gap-2" role="tablist" aria-label="Company details sections">
          {sections.map((section, index) => (
            <button
              key={section.title}
              type="button"
              role="tab"
              aria-selected={activeSection === index}
              onClick={() => setActiveSection(index)}
              className={`flex-1 border-b-2 px-2 pb-2 text-left transition-colors ${
                activeSection === index ? 'border-blue-600 text-blue-700' : 'border-slate-200 text-slate-400 hover:text-slate-600'
              }`}
            >
              <span className="block text-[10px] font-bold uppercase tracking-wider">Section {index + 1}</span>
              <span className="block text-xs font-semibold truncate">{section.title}</span>
            </button>
          ))}
        </div>

        <form onSubmit={handleSubmit} className="mt-5 space-y-4 text-xs">
          <p className="text-[11px] text-slate-500">{sections[activeSection].description}</p>
          <div className="min-h-[280px]">
            {activeSection === 0 && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="Company Legal Name *" value={form.name} onChange={(value) => setField('name', value)} className="sm:col-span-2" placeholder="LUMORA TECH SDN BHD" />
                <Field label="Short Name" value={form.short_name} onChange={(value) => setField('short_name', value)} placeholder="LUMORA" />
                <SelectField label="Company Category *" value={form.company_type} onChange={(value) => setField('company_type', value)} options={['FORWARDER', 'HAULAGE', 'TRANSPORT']} />
                <Field label="Registration No (Primary) *" value={form.registration_number} onChange={(value) => setField('registration_number', value)} className="font-mono" placeholder="AAAAAA-2" />
                <Field label="Old Registration No" value={form.registration_number_old || ''} onChange={(value) => setField('registration_number_old', value)} className="font-mono" placeholder="AAAAAA-2" />
                <Field label="SSM New 12-Digit Reg No" value={form.registration_number_new || ''} onChange={(value) => setField('registration_number_new', value)} className="font-mono" placeholder="201901004521" />
              </div>
            )}

            {activeSection === 1 && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="HAULIERID" value={form.haulier_id || ''} onChange={(value) => setField('haulier_id', value)} className="font-mono" placeholder="xyz456" />
                <Field label="FORWARDING_AGENT_ID" value={form.forwarding_agent_id || ''} onChange={(value) => setField('forwarding_agent_id', value)} className="font-mono" placeholder="64abc123xyz" />
                <SelectField label="Primary Port" value={form.port_id || ''} onChange={(value) => { setField('port_id', value); setField('depot_id', ''); }} options={ports.map((port) => ({ value: port.id, label: `${port.display_name} (${port.location})` }))} />
                <SelectField label="Primary Depot" value={form.depot_id || ''} onChange={(value) => setField('depot_id', value)} options={[{ value: '', label: 'No depot assigned' }, ...depots.filter((depot) => !form.port_id || depot.port_id === form.port_id).map((depot) => ({ value: depot.id, label: depot.display_name }))]} />
                <SelectField label="Master Status" value={form.status} onChange={(value) => setField('status', value as Company['status'])} options={['ACTIVE', 'INACTIVE']} />
                <div className="rounded-lg border border-blue-100 bg-blue-50 p-3 text-[11px] text-blue-800 sm:col-span-2">
                  The active external ID is determined by company category. Keep the other ID populated only when this company needs both mappings.
                </div>
              </div>
            )}

            {activeSection === 2 && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="Block / Building" value={form.block || ''} onChange={(value) => setField('block', value)} />
                <Field label="Country" value={form.country || ''} onChange={(value) => setField('country', value)} />
                <Field label="Address Line 1" value={form.address1 || ''} onChange={(value) => setField('address1', value)} className="sm:col-span-2" />
                <Field label="Address Line 2" value={form.address2 || ''} onChange={(value) => setField('address2', value)} className="sm:col-span-2" />
                <Field label="City" value={form.city || ''} onChange={(value) => setField('city', value)} />
                <Field label="State" value={form.state || ''} onChange={(value) => setField('state', value)} />
                <Field label="Postcode" value={form.postcode || ''} onChange={(value) => setField('postcode', value)} />
                <Field label="Contact Person" value={form.contact_name || ''} onChange={(value) => setField('contact_name', value)} />
                <Field label="Contact Designation" value={form.contact_designation || ''} onChange={(value) => setField('contact_designation', value)} />
                <Field label="Contact Email" type="email" value={form.contact_email || ''} onChange={(value) => setField('contact_email', value)} />
                <Field label="Contact Mobile" value={form.contact_mobile || ''} onChange={(value) => setField('contact_mobile', value)} />
                <Field label="Office Phone" value={form.office_phone || ''} onChange={(value) => setField('office_phone', value)} />
                <Field label="Fax" value={form.fax || ''} onChange={(value) => setField('fax', value)} />
              </div>
            )}
          </div>

          <div className="flex items-center justify-end gap-2 pt-4 border-t border-slate-100">
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
              <button type="submit" className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg shadow-sm">
                {isEditing ? 'Save Changes' : 'Create Master Company'}
              </button>
            )}
          </div>
        </form>

        {false && <form onSubmit={handleSubmit} className="mt-4 space-y-4 text-xs">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="block font-semibold text-slate-700 mb-1">Company Legal Name *</label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-blue-500 uppercase"
                placeholder="LUMORA TECH SDN BHD"
              />
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">Short Name *</label>
              <input
                type="text"
                value={form.short_name}
                onChange={(e) => setForm({ ...form, short_name: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-blue-500 uppercase"
                placeholder="LUMORA"
              />
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">Company Category *</label>
              <select
                value={form.company_type}
                onChange={(e) => setForm({ ...form, company_type: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-blue-500 bg-white"
              >
                <option value="FORWARDER">FORWARDER (Uses FORWARDING_AGENT_ID)</option>
                <option value="HAULAGE">HAULAGE (Uses HAULIERID)</option>
                <option value="TRANSPORT">TRANSPORT (Uses FORWARDING_AGENT_ID)</option>
              </select>
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">
                Old Registration No (Unique Primary Key) *
              </label>
              <input
                type="text"
                value={form.registration_number}
                onChange={(e) => setForm({ ...form, registration_number: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-blue-500 font-mono uppercase"
                placeholder="AAAAAA-2"
              />
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">SSM New 12-Digit Reg No</label>
              <input
                type="text"
                value={form.registration_number_new}
                onChange={(e) => setForm({ ...form, registration_number_new: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-blue-500 font-mono"
                placeholder="201901004521"
              />
            </div>

            <div>
              <label className="block font-semibold text-emerald-800 mb-1">
                HAULIERID (for Haulage entities)
              </label>
              <input
                type="text"
                value={form.haulier_id}
                onChange={(e) => setForm({ ...form, haulier_id: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-emerald-500 font-mono"
                placeholder="xyz456"
              />
            </div>

            <div>
              <label className="block font-semibold text-blue-800 mb-1">
                FORWARDING_AGENT_ID (for Forwarders)
              </label>
              <input
                type="text"
                value={form.forwarding_agent_id}
                onChange={(e) => setForm({ ...form, forwarding_agent_id: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-blue-500 font-mono"
                placeholder="64abc123xyz"
              />
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">Primary Port</label>
              <select
                value={form.port_id}
                onChange={(e) => setForm({ ...form, port_id: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-white"
              >
                {ports.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.display_name} ({p.location})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">City</label>
              <input
                type="text"
                value={form.city}
                onChange={(e) => setForm({ ...form, city: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-slate-300"
              />
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">Contact Person</label>
              <input
                type="text"
                value={form.contact_name}
                onChange={(e) => setForm({ ...form, contact_name: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-slate-300"
              />
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">Contact Mobile</label>
              <input
                type="text"
                value={form.contact_mobile}
                onChange={(e) => setForm({ ...form, contact_mobile: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-slate-300"
              />
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 pt-4 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg shadow-sm"
            >
              {isEditing ? 'Save Changes' : 'Create Master Company'}
            </button>
          </div>
        </form>}
      </div>
    </div>
  );
}

type CompanyFormState = Omit<Company, 'created_at' | 'updated_at'>;

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
    <label className={`block ${className}`}>
      <span className="block font-semibold text-slate-700 mb-1">{label}</span>
      <input type={type} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-blue-500 focus:outline-none" />
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
    <label className="block">
      <span className="block font-semibold text-slate-700 mb-1">{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)} className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-white focus:ring-2 focus:ring-blue-500 focus:outline-none">
        {options.map((option) => {
          const normalized = typeof option === 'string' ? { value: option, label: option } : option;
          return <option key={normalized.value} value={normalized.value}>{normalized.label}</option>;
        })}
      </select>
    </label>
  );
}
