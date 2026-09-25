import React, { useState } from 'react';
import { EXCEL_TEMPLATES } from '../../services/excelExport';
import { RegistrationType } from '../../types';
import { FileSpreadsheet, Database, CheckCircle2, Info } from 'lucide-react';

interface MappingItem {
  excelCol: string;
  order: number;
  dbField: string;
  formLabel: string;
  dataType: string;
  source: 'Customer Input' | 'Automated System / Company Master' | 'Port Configuration';
  notes: string;
}

const COMPANY_MAPPINGS: MappingItem[] = [
  { excelCol: 'HAULIERID', order: 1, dbField: 'company.haulier_id', formLabel: 'Internal Haulier ID', dataType: 'String', source: 'Automated System / Company Master', notes: 'Populated if category is Haulier/Haulage; blank otherwise.' },
  { excelCol: 'FORWARDING_AGENT_ID', order: 2, dbField: 'company.forwarding_agent_id', formLabel: 'Internal Forwarding Agent ID', dataType: 'String', source: 'Automated System / Company Master', notes: 'Populated if category is Forwarder/Transporter; blank otherwise.' },
  { excelCol: 'NAME', order: 3, dbField: 'company.name', formLabel: 'Company Name', dataType: 'String', source: 'Customer Input', notes: 'Full legal company name registered with SSM.' },
  { excelCol: 'SHORTNAME', order: 4, dbField: 'company.short_name', formLabel: 'Company Short Name', dataType: 'String', source: 'Customer Input', notes: 'Abbreviated trade name for depot displays.' },
  { excelCol: 'TYPE', order: 5, dbField: 'company.company_type', formLabel: 'Company Type', dataType: 'String', source: 'Customer Input', notes: 'HAULAGE, FORWARDER, or TRANSPORT. Exported as HAULAGE or FORWARDER.' },
  { excelCol: 'REGISTRATION', order: 6, dbField: 'company.registration_number_old', formLabel: 'Old Company Registration Number', dataType: 'String', source: 'Customer Input', notes: 'e.g. AAAAAA-2. Primary lookup key.' },
  { excelCol: 'REGISTRATION_NEW', order: 7, dbField: 'company.registration_number_new', formLabel: 'New Company Registration Number', dataType: 'String', source: 'Customer Input', notes: 'SSM 12-digit format.' },
  { excelCol: 'PORTS', order: 8, dbField: 'company.assigned_port_ids (resolved)', formLabel: 'Assigned Ports', dataType: 'String', source: 'Port Configuration', notes: 'All assigned ports are mapped to backend IDs and exported comma-separated.' },
  { excelCol: 'DEPOTS', order: 9, dbField: 'company.assigned_depot_ids (resolved)', formLabel: 'Assigned Depots', dataType: 'String', source: 'Port Configuration', notes: 'All assigned depots are mapped to backend IDs and exported comma-separated.' },
  { excelCol: 'BLOCK', order: 10, dbField: 'company.block', formLabel: 'Building / Block', dataType: 'String', source: 'Customer Input', notes: 'Unit / block / floor.' },
  { excelCol: 'ADDRESS1', order: 11, dbField: 'company.address1', formLabel: 'Address Line 1', dataType: 'String', source: 'Customer Input', notes: 'Street address.' },
  { excelCol: 'ADDRESS2', order: 12, dbField: 'company.address2', formLabel: 'Address Line 2', dataType: 'String', source: 'Customer Input', notes: 'Industrial park / area.' },
  { excelCol: 'CITY', order: 13, dbField: 'company.city', formLabel: 'City', dataType: 'String', source: 'Customer Input', notes: 'e.g. Pasir Gudang, Pelabuhan Klang.' },
  { excelCol: 'STATE', order: 14, dbField: 'company.state', formLabel: 'State', dataType: 'String', source: 'Customer Input', notes: 'e.g. Johor, Selangor.' },
  { excelCol: 'POSTCODE', order: 15, dbField: 'company.postcode', formLabel: 'Postcode', dataType: 'String', source: 'Customer Input', notes: '5-digit postal code.' },
  { excelCol: 'COUNTRY', order: 16, dbField: 'company.country', formLabel: 'Country', dataType: 'String', source: 'Customer Input', notes: 'Default: Malaysia.' },
  { excelCol: 'CONTACTNAME', order: 17, dbField: 'company.contact_name', formLabel: 'Contact Person', dataType: 'String', source: 'Customer Input', notes: 'Operational liaison.' },
  { excelCol: 'CONTACTEMAIL', order: 18, dbField: 'company.contact_email', formLabel: 'Contact Email', dataType: 'Email', source: 'Customer Input', notes: 'Primary notification email.' },
  { excelCol: 'CONTACTDESGN', order: 19, dbField: 'company.contact_designation', formLabel: 'Designation', dataType: 'String', source: 'Customer Input', notes: 'Job title.' },
  { excelCol: 'CONTACTMOBILE', order: 20, dbField: 'company.contact_mobile', formLabel: 'Mobile Number', dataType: 'Phone', source: 'Customer Input', notes: 'Primary mobile number.' },
  { excelCol: 'OFFICE', order: 21, dbField: 'company.office_phone', formLabel: 'Office Phone', dataType: 'Phone', source: 'Customer Input', notes: 'Fixed office line.' },
  { excelCol: 'FAX', order: 22, dbField: 'company.fax', formLabel: 'Fax Number', dataType: 'String', source: 'Customer Input', notes: 'Office facsimile line.' },
];

const DRIVER_MAPPINGS: MappingItem[] = [
  { excelCol: 'DRIVINGLICENSE', order: 1, dbField: 'driver.driving_license', formLabel: 'Driving Licence / Identification', dataType: 'String', source: 'Customer Input', notes: 'Driver NRIC or commercial license code.' },
  { excelCol: 'HAULIERID', order: 2, dbField: 'company.haulier_id', formLabel: 'Auto-resolved from Company Master', dataType: 'String', source: 'Automated System / Company Master', notes: 'Retrieved automatically from parent company record.' },
  { excelCol: 'FORWARDING_AGENT_ID', order: 3, dbField: 'company.forwarding_agent_id', formLabel: 'Auto-resolved from Company Master', dataType: 'String', source: 'Automated System / Company Master', notes: 'Retrieved automatically from parent company record.' },
  { excelCol: 'COMPANYTYPE', order: 4, dbField: 'company.company_type (normalized)', formLabel: 'Company Type', dataType: 'String', source: 'Automated System / Company Master', notes: 'Normalized to HAULIER or FORWARDING.' },
  { excelCol: 'MOBILENO', order: 5, dbField: 'driver.mobile_no', formLabel: 'Driver Mobile Number', dataType: 'Phone', source: 'Customer Input', notes: 'Driver direct contact line.' },
  { excelCol: 'NAME', order: 6, dbField: 'driver.name', formLabel: 'Driver Full Name', dataType: 'String', source: 'Customer Input', notes: 'Legal name per identity document.' },
  { excelCol: 'PORTS', order: 7, dbField: 'port.backend_port_id', formLabel: 'Facility Backend Code', dataType: 'String', source: 'Port Configuration', notes: 'Configured backend port code (e.g. 5cad3ffb4fe26b4cf4ca563c).' },
];

const TRAILER_MAPPINGS: MappingItem[] = [
  { excelCol: 'REGISTRATION', order: 1, dbField: 'trailer.registration_number', formLabel: 'Trailer Registration Number', dataType: 'String', source: 'Customer Input', notes: 'License plate number of trailer / chassis.' },
  { excelCol: 'HAULIERID', order: 2, dbField: 'company.haulier_id', formLabel: 'Auto-resolved from Company Master', dataType: 'String', source: 'Automated System / Company Master', notes: 'Automatic lookup from Company Master.' },
  { excelCol: 'FORWARDING_AGENT_ID', order: 3, dbField: 'company.forwarding_agent_id', formLabel: 'Auto-resolved from Company Master', dataType: 'String', source: 'Automated System / Company Master', notes: 'Automatic lookup from Company Master.' },
  { excelCol: 'COMPANYTYPE', order: 4, dbField: 'company.company_type (normalized)', formLabel: 'Company Category', dataType: 'String', source: 'Automated System / Company Master', notes: 'HAULIER or FORWARDING.' },
  { excelCol: 'WEIGHT', order: 5, dbField: 'trailer.weight', formLabel: 'Unladen Weight (KG)', dataType: 'Numeric String', source: 'Customer Input', notes: 'Kerb chassis weight.' },
  { excelCol: 'TYPE', order: 6, dbField: 'trailer.trailer_type', formLabel: 'Trailer Type', dataType: 'String', source: 'Customer Input', notes: 'e.g. Skeletal 40ft, Flatbed, Box.' },
  { excelCol: 'BDM_WEIGHT', order: 7, dbField: 'trailer.bdm_weight', formLabel: 'BDM Weight (KG)', dataType: 'Numeric String', source: 'Customer Input', notes: 'Berat Dengan Muatan.' },
  { excelCol: 'PORTS', order: 8, dbField: 'port.backend_port_id', formLabel: 'Port Backend Code', dataType: 'String', source: 'Port Configuration', notes: 'Configured backend terminal ID.' },
];

const VEHICLE_MAPPINGS: MappingItem[] = [
  { excelCol: 'REGISTRATION', order: 1, dbField: 'vehicle.registration_number', formLabel: 'Vehicle Registration Number', dataType: 'String', source: 'Customer Input', notes: 'Prime mover license plate.' },
  { excelCol: 'HAULIERID', order: 2, dbField: 'company.haulier_id', formLabel: 'Auto-resolved from Company Master', dataType: 'String', source: 'Automated System / Company Master', notes: 'Automatic lookup from Company Master.' },
  { excelCol: 'FORWARDING_AGENT_ID', order: 3, dbField: 'company.forwarding_agent_id', formLabel: 'Auto-resolved from Company Master', dataType: 'String', source: 'Automated System / Company Master', notes: 'Automatic lookup from Company Master.' },
  { excelCol: 'COMPANYTYPE', order: 4, dbField: 'company.company_type (normalized)', formLabel: 'Company Category', dataType: 'String', source: 'Automated System / Company Master', notes: 'HAULIER or FORWARDING.' },
  { excelCol: 'WEIGHT', order: 5, dbField: 'vehicle.weight', formLabel: 'Unladen Weight (KG)', dataType: 'Numeric String', source: 'Customer Input', notes: 'Kerb weight of vehicle.' },
  { excelCol: 'BGK_WEIGHT', order: 6, dbField: 'vehicle.bgk_weight', formLabel: 'BGK Weight (KG)', dataType: 'Numeric String', source: 'Customer Input', notes: 'Berat Gabungan Kasar.' },
  { excelCol: 'HEAD', order: 7, dbField: 'vehicle.head', formLabel: 'Prime Mover / Head Specification', dataType: 'String', source: 'Customer Input', notes: 'e.g. Scania R450 6x2 / Volvo FH16.' },
  { excelCol: 'PORTS', order: 8, dbField: 'port.backend_port_id', formLabel: 'Port Backend Code', dataType: 'String', source: 'Port Configuration', notes: 'Configured backend terminal ID.' },
];

export function SchemaMappingInspector() {
  const [activeTab, setActiveTab] = useState<RegistrationType>('COMPANY');

  const getMappings = () => {
    switch (activeTab) {
      case 'COMPANY':
        return COMPANY_MAPPINGS;
      case 'DRIVER':
        return DRIVER_MAPPINGS;
      case 'TRAILER':
        return TRAILER_MAPPINGS;
      case 'VEHICLE':
        return VEHICLE_MAPPINGS;
    }
  };

  const mappings = getMappings();

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-slate-900 tracking-tight">
          Excel Template & Database Schema Inspector
        </h2>
        <p className="text-xs text-slate-500 mt-1">
          Exact column-by-column schema specification matching the existing backend Excel importer templates.
        </p>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-slate-200">
        {[
          { key: 'COMPANY', name: 'Admin_Company_Template.xlsx (22 cols)' },
          { key: 'DRIVER', name: 'Admin_Driver_Template.xlsx (7 cols)' },
          { key: 'TRAILER', name: 'Admin_Trailer_Template.xlsx (8 cols)' },
          { key: 'VEHICLE', name: 'Admin_Vehicle_Template.xlsx (8 cols)' },
        ].map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key as RegistrationType)}
            className={`px-4 py-2.5 text-xs font-bold border-b-2 transition-colors ${
              activeTab === tab.key
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            {tab.name}
          </button>
        ))}
      </div>

      {/* Architecture note */}
      <div className="p-4 rounded-xl bg-blue-50/70 border border-blue-200 text-xs text-blue-900 flex items-start gap-3">
        <Info className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
        <div>
          <strong>Backend Compliance Guarantee:</strong> Every export generated by this portal strictly preserves the exact column order, spelling, and capitalization shown below. Database IDs (<code className="bg-blue-100 px-1 py-0.5 rounded font-mono">HAULIERID</code> / <code className="bg-blue-100 px-1 py-0.5 rounded font-mono">FORWARDING_AGENT_ID</code>) are automatically resolved via the Company Master relationship.
        </div>
      </div>

      {/* Mapping Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-bold uppercase tracking-wider">
                <th className="py-3 px-3 w-12 text-center">#</th>
                <th className="py-3 px-4 font-mono text-blue-700">Excel Column Header</th>
                <th className="py-3 px-4 text-slate-700">Customer Form Label</th>
                <th className="py-3 px-4 font-mono text-emerald-700">Database Field</th>
                <th className="py-3 px-3">Data Source</th>
                <th className="py-3 px-4">Business Rules / Notes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {mappings.map((m) => (
                <tr key={m.excelCol} className="hover:bg-slate-50/60 transition-colors">
                  <td className="py-2.5 px-3 text-center font-mono text-slate-400 font-semibold">
                    {m.order}
                  </td>
                  <td className="py-2.5 px-4 font-mono font-bold text-slate-900">
                    {m.excelCol}
                  </td>
                  <td className="py-2.5 px-4 font-medium text-slate-800">
                    {m.formLabel}
                  </td>
                  <td className="py-2.5 px-4 font-mono text-xs text-slate-600">
                    {m.dbField}
                  </td>
                  <td className="py-2.5 px-3">
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold ${
                        m.source === 'Customer Input'
                          ? 'bg-purple-50 text-purple-700 border border-purple-200'
                          : m.source === 'Port Configuration'
                          ? 'bg-blue-50 text-blue-700 border border-blue-200'
                          : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                      }`}
                    >
                      {m.source}
                    </span>
                  </td>
                  <td className="py-2.5 px-4 text-slate-600 leading-relaxed">
                    {m.notes}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
