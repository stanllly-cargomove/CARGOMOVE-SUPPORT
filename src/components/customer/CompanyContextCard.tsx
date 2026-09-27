import { Company } from '../../types';
import { Building2 } from 'lucide-react';

interface CompanyContextCardProps {
  company: Company;
  assignedFacilities: string[];
}

export function CompanyContextCard({ company, assignedFacilities }: CompanyContextCardProps) {
  return (
    <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 flex items-center justify-between">
      <div className="flex items-center gap-2.5">
        <div className="w-8 h-8 rounded bg-sky-100 text-[#0090e7] flex items-center justify-center font-bold">
          <Building2 className="w-4 h-4" />
        </div>
        <div>
          <div className="text-[10px] text-slate-400 uppercase font-bold">Registered Company</div>
          <div className="text-xs font-bold text-slate-900">{company.name}</div>
          <div className="text-[11px] text-slate-500">
            Reg: {company.registration_number} &bull; Type: {company.company_type}
          </div>
        </div>
      </div>

      <div className="text-right">
        <div className="text-[10px] text-slate-400 uppercase font-bold">Assigned Facilities</div>
        <div className="text-xs font-bold text-sky-700">{assignedFacilities.join(', ')}</div>
      </div>
    </div>
  );
}
