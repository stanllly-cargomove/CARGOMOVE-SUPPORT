import React, { useRef, useState } from 'react';
import {
  PortLocation,
  RegistrationType,
  Company,
  CompanyFormData,
  DriverData,
  TrailerData,
  VehicleData,
  PortConfig,
} from '../../types';
import {
  CheckCircle2,
  Building2,
  User,
  Container,
  Truck,
  ShieldCheck,
  Copy,
  Check,
  RefreshCw,
} from 'lucide-react';

interface ReviewAndSubmitProps {
  location: PortLocation;
  port: PortConfig;
  type: RegistrationType;
  company: Company | null;
  formData: {
    company?: CompanyFormData;
    userAccess?: {
      username: string;
      email: string;
      full_name: string;
      mobile_number: string;
    };
    driver?: DriverData;
    drivers?: DriverData[];
    trailer?: TrailerData;
    trailers?: TrailerData[];
    vehicle?: VehicleData;
    vehicles?: VehicleData[];
  };
  onBack: () => void;
  onSubmitSuccess: () => Promise<string>;
}

export function ReviewScreen({
  location,
  type,
  company,
  formData,
  onBack,
  onSubmitSuccess,
}: ReviewAndSubmitProps) {
  const [agreed, setAgreed] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const touchStartX = useRef<number | null>(null);

  const handleSubmit = async () => {
    if (!agreed) return;
    setSubmitting(true);
    setSubmitError('');
    try {
      await onSubmitSuccess();
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : 'Unable to submit the registration.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleTouchStart = (event: React.TouchEvent<HTMLDivElement>) => {
    touchStartX.current = event.changedTouches[0]?.clientX ?? null;
  };

  const handleTouchEnd = (event: React.TouchEvent<HTMLDivElement>) => {
    if (touchStartX.current === null) return;
    const swipeDistance = event.changedTouches[0].clientX - touchStartX.current;
    touchStartX.current = null;
    if (swipeDistance > 50) onBack();
  };

  return (
    <div
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      className="max-w-4xl mx-auto min-h-[calc(100vh-220px)] flex flex-col gap-2 pb-2 touch-pan-y page-slide-forward"
    >
      <div className="text-center shrink-0">
        <h2 className="text-sm font-bold text-slate-900 tracking-tight">Review & Confirm Submission</h2>
        <p className="text-slate-500 text-[11px] mt-0.5">
          Please verify all entered details before queueing into the Port Master database.
        </p>
      </div>

      <div className="bg-white rounded-lg border border-slate-200 p-3 shadow-xs space-y-2">
        {/* Header Summary */}
        <div className="flex items-center justify-between pb-2 border-b border-slate-100">
          <div>
            <div className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Category</div>
            <div className="text-sm font-bold text-slate-900 mt-0.5">
              {type === 'COMPANY' && 'Company Master Onboarding'}
              {type === 'DRIVER' && 'Driver Gate Access'}
              {type === 'TRAILER' && 'Trailer / Chassis Registration'}
              {type === 'VEHICLE' && 'Prime Mover / Vehicle Registration'}
            </div>
          </div>

          <div className="text-right">
            <div className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Port Location</div>
            <div className="text-xs font-bold text-[#0090e7] mt-0.5">
              {location === 'PORT_KLANG' ? 'Port Klang' : 'Johor'}
            </div>
          </div>
        </div>

        {/* Company context if driver/trailer/vehicle */}
        {company && type !== 'COMPANY' && (
          <div className="bg-slate-50 rounded p-2 border border-slate-200">
            <div className="text-[10px] font-bold text-slate-500 uppercase">Registered Parent Haulier / Forwarder</div>
            <div className="text-xs font-bold text-slate-900 mt-0.5">{company.name}</div>
            <div className="text-[11px] text-slate-600 mt-0.5">
              Reg No: <span className="font-mono font-semibold">{company.registration_number}</span> &bull; Type: {company.company_type}
            </div>
          </div>
        )}

        {/* Company Registration Summary */}
        {type === 'COMPANY' && formData.company && (
          <div className="space-y-1.5 text-xs">
            <section className="rounded border border-sky-100 bg-sky-50/50 p-2">
              <h3 className="text-[10px] font-bold uppercase tracking-wider text-slate-900 border-b border-sky-100 pb-1 mb-1.5">
                Company Details
              </h3>
              <div className="grid grid-cols-2 gap-x-12 items-start">
                <div className="space-y-1.5 min-w-0">
                  <div>
                    <span className="text-[11px] text-slate-900 block font-bold">Legal Name</span>
                    <span className="text-[10px] leading-4 font-normal text-slate-900 break-words block">{formData.company.name}</span>
                  </div>
                  <div>
                    <span className="text-[11px] text-slate-900 block font-bold">Short Name</span>
                    <span className="text-[10px] leading-4 font-normal text-slate-900 break-words block">{formData.company.short_name}</span>
                  </div>
                  <div>
                    <span className="text-[11px] text-slate-900 block font-bold">Company Type</span>
                    <span className="text-[10px] leading-4 font-normal text-slate-900 block">{formData.company.company_type}</span>
                  </div>
                  <div>
                    <span className="text-[11px] text-slate-900 block font-bold">Registration (Old / SSM)</span>
                    <span className="text-[10px] leading-4 font-normal text-slate-900 break-words block">
                      {formData.company.registration_number_old} {formData.company.registration_number_new ? `/ ${formData.company.registration_number_new}` : ''}
                    </span>
                  </div>
                </div>
                <div className="space-y-1.5 min-w-0">
                  <div>
                    <span className="text-[11px] text-slate-900 block font-bold">Registered Address</span>
                    <span className="text-[10px] leading-4 text-slate-900 block break-words">
                      {formData.company.block ? `${formData.company.block}, ` : ''}
                      {formData.company.address1}, {formData.company.address2 ? `${formData.company.address2}, ` : ''}
                      {formData.company.city}, {formData.company.state} {formData.company.postcode}, {formData.company.country}
                    </span>
                  </div>
                  <div>
                    <span className="text-[11px] text-slate-900 block font-bold">Contact Person</span>
                    <span className="text-[10px] leading-4 font-normal text-slate-900 block break-words">
                      {formData.company.contact_name}
                      {formData.company.contact_designation ? ` (${formData.company.contact_designation})` : ''}
                    </span>
                  </div>
                  <div>
                    <span className="text-[11px] text-slate-900 block font-bold">PIC Contact Details</span>
                    <span className="text-[10px] leading-4 text-slate-900 block break-words">
                      {formData.company.contact_email} &bull; {formData.company.contact_mobile}
                      {formData.company.office_phone ? ` &bull; Office: ${formData.company.office_phone}` : ''}
                      {formData.company.fax ? ` &bull; Fax: ${formData.company.fax}` : ''}
                    </span>
                  </div>
                </div>
              </div>
            </section>
            {formData.userAccess && (
              <section className="rounded border border-emerald-100 bg-emerald-50/50 p-2">
                <h3 className="text-[10px] font-bold uppercase tracking-wider text-slate-900 border-b border-emerald-100 pb-1 mb-1.5">
                  Login Account
                </h3>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                  <div>
                    <span className="text-[11px] text-slate-900 block font-bold">Username</span>
                    <span className="text-[10px] leading-4 font-normal text-slate-900 block break-words">{formData.userAccess.username}</span>
                  </div>
                  <div>
                    <span className="text-[11px] text-slate-900 block font-bold">Full Name</span>
                    <span className="text-[10px] leading-4 font-normal text-slate-900 block break-words">{formData.userAccess.full_name}</span>
                  </div>
                  <div>
                    <span className="text-[11px] text-slate-900 block font-bold">Email</span>
                    <span className="text-[10px] leading-4 text-slate-900 block break-words">{formData.userAccess.email}</span>
                  </div>
                  <div>
                    <span className="text-[11px] text-slate-900 block font-bold">Mobile Number</span>
                    <span className="text-[10px] leading-4 text-slate-900 block break-words">{formData.userAccess.mobile_number}</span>
                  </div>
                </div>
              </section>
            )}
          </div>
        )}

        {/* Driver Summary */}
        {type === 'DRIVER' && (
          <div className="space-y-2">
            <div className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">
              Registered Driver Assets ({formData.drivers?.length || (formData.driver ? 1 : 0)})
            </div>
            <div className="overflow-x-auto border border-slate-200 rounded">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-[10px] font-bold text-slate-600 uppercase">
                    <th className="py-2 px-2.5 w-8 text-center">#</th>
                    <th className="py-2 px-2.5">Driver Full Name</th>
                    <th className="py-2 px-2.5">Licence / NRIC</th>
                    <th className="py-2 px-2.5">Mobile Contact</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {(formData.drivers && formData.drivers.length > 0
                    ? formData.drivers
                    : formData.driver
                    ? [formData.driver]
                    : []
                  ).map((drv, i) => (
                    <tr key={i} className="hover:bg-slate-50/50">
                      <td className="py-1.5 px-2.5 text-center text-[10px] text-slate-400 font-bold font-mono">
                        {i + 1}
                      </td>
                      <td className="py-1.5 px-2.5 font-bold text-slate-900">{drv.name}</td>
                      <td className="py-1.5 px-2.5 font-mono text-slate-700">{drv.driving_license}</td>
                      <td className="py-1.5 px-2.5 text-slate-700">{drv.mobile_no}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Trailer Summary */}
        {type === 'TRAILER' && (
          <div className="space-y-2">
            <div className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">
              Registered Trailer Assets ({formData.trailers?.length || (formData.trailer ? 1 : 0)})
            </div>
            <div className="overflow-x-auto border border-slate-200 rounded">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-[10px] font-bold text-slate-600 uppercase">
                    <th className="py-2 px-2.5 w-8 text-center">#</th>
                    <th className="py-2 px-2.5">Plate Number</th>
                    <th className="py-2 px-2.5">Chassis Type</th>
                    <th className="py-2 px-2.5">Unladen Wt</th>
                    <th className="py-2 px-2.5">BDM Wt</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {(formData.trailers && formData.trailers.length > 0
                    ? formData.trailers
                    : formData.trailer
                    ? [formData.trailer]
                    : []
                  ).map((trl, i) => (
                    <tr key={i} className="hover:bg-slate-50/50">
                      <td className="py-1.5 px-2.5 text-center text-[10px] text-slate-400 font-bold font-mono">
                        {i + 1}
                      </td>
                      <td className="py-1.5 px-2.5 font-mono font-bold text-slate-900">
                        {trl.registration_number}
                      </td>
                      <td className="py-1.5 px-2.5 font-semibold text-slate-800">
                        <span className="px-1.5 py-0.5 rounded bg-sky-50 text-[#0090e7] font-bold text-[10px] border border-sky-100">
                          {trl.trailer_type}
                        </span>
                      </td>
                      <td className="py-1.5 px-2.5 font-mono text-slate-700">{trl.weight} KG</td>
                      <td className="py-1.5 px-2.5 font-mono text-slate-700">{trl.bdm_weight} KG</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Vehicle Summary */}
        {type === 'VEHICLE' && (
          <div className="space-y-2">
            <div className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">
              Registered Prime Mover Vehicles ({formData.vehicles?.length || (formData.vehicle ? 1 : 0)})
            </div>
            <div className="overflow-x-auto border border-slate-200 rounded">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-[10px] font-bold text-slate-600 uppercase">
                    <th className="py-2 px-2.5 w-8 text-center">#</th>
                    <th className="py-2 px-2.5">Plate Number</th>
                    <th className="py-2 px-2.5">Head Number</th>
                    <th className="py-2 px-2.5">Unladen Wt</th>
                    <th className="py-2 px-2.5">BGK Wt</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {(formData.vehicles && formData.vehicles.length > 0
                    ? formData.vehicles
                    : formData.vehicle
                    ? [formData.vehicle]
                    : []
                  ).map((veh, i) => (
                    <tr key={i} className="hover:bg-slate-50/50">
                      <td className="py-1.5 px-2.5 text-center text-[10px] text-slate-400 font-bold font-mono">
                        {i + 1}
                      </td>
                      <td className="py-1.5 px-2.5 font-mono font-bold text-slate-900">
                        {veh.registration_number}
                      </td>
                      <td className="py-1.5 px-2.5 font-mono font-bold text-sky-700">
                        {veh.head}
                      </td>
                      <td className="py-1.5 px-2.5 font-mono text-slate-700">{veh.weight} KG</td>
                      <td className="py-1.5 px-2.5 font-mono text-slate-700">{veh.bgk_weight} KG</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Declaration Checkbox */}
        <div className="pt-1.5 border-t border-slate-100">
          <label className="flex items-start gap-2 cursor-pointer text-[11px] text-slate-700">
            <input
              type="checkbox"
              checked={agreed}
              onChange={(e) => setAgreed(e.target.checked)}
              className="mt-0.5 rounded border-slate-300 text-sky-600 focus:ring-sky-500"
            />
            <span>
              I declare that the information submitted above is true, accurate, and authorized by company management.
            </span>
          </label>
        </div>
      </div>

      <div className="flex items-center justify-between pt-0.5 mt-auto shrink-0">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex h-9 items-center gap-1.5 px-3.5 py-0 rounded text-xs font-semibold text-slate-600 hover:bg-slate-100 transition-colors"
        >
          &larr; Back to Edit
        </button>

        <button
          type="button"
          disabled={!agreed || submitting}
          onClick={handleSubmit}
          className="inline-flex h-9 items-center px-5 py-0 rounded text-xs font-bold text-white bg-[#ea7a24] hover:bg-[#d96c1a] disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-xs"
        >
          {submitting ? (
            <>
              <RefreshCw className="w-3.5 h-3.5 mr-1.5 animate-spin" />
              Submitting...
            </>
          ) : (
            <>
              <ShieldCheck className="w-3.5 h-3.5 mr-1.5" />
              Confirm & Submit Registration
            </>
          )}
        </button>
      </div>
      {submitError && (
        <p role="alert" className="rounded border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
          {submitError}
        </p>
      )}
    </div>
  );
}

interface SuccessScreenProps {
  referenceNo: string;
  type: RegistrationType;
  onReset: () => void;
  onViewTracker: () => void;
}

export function SuccessScreen({
  referenceNo,
  type,
  onReset,
  onViewTracker,
}: SuccessScreenProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(referenceNo);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="max-w-lg mx-auto text-center space-y-4 py-4">
      <div className="w-12 h-12 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto shadow-xs">
        <CheckCircle2 className="w-7 h-7" />
      </div>

      <div>
        <h2 className="text-lg font-bold text-slate-900 tracking-tight">Registration Submitted Successfully</h2>
        <p className="text-slate-500 text-xs mt-1">
          Your application has been received and queued for admin verification and backend EDI export.
        </p>
      </div>

      {/* Reference Box */}
      <div className="bg-white border border-slate-200 rounded-lg p-3.5 shadow-xs">
        <div className="text-[10px] text-slate-400 font-bold uppercase tracking-wider mb-1">
          Registration Reference Number
        </div>
        <div className="flex items-center justify-center gap-2">
          <span className="font-mono text-base font-black text-slate-900 tracking-wider">
            {referenceNo}
          </span>
          <button
            type="button"
            onClick={handleCopy}
            className="p-1 rounded hover:bg-slate-100 text-slate-500 transition-colors"
            title="Copy reference number"
          >
            {copied ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
          </button>
        </div>
        <p className="text-[11px] text-slate-500 mt-2">
          Save this reference to track approval status or provide to port gate operators.
        </p>
      </div>

      <div className="flex items-center justify-center gap-3 pt-2">
        <button
          type="button"
          onClick={onViewTracker}
          className="px-4 py-1.5 rounded text-xs font-semibold bg-white border border-slate-300 text-slate-700 hover:bg-slate-50 transition-colors"
        >
          Check Status
        </button>

        <button
          type="button"
          onClick={onReset}
          className="px-4 py-1.5 rounded text-xs font-bold text-white bg-[#ea7a24] hover:bg-[#d96c1a] transition-colors shadow-xs"
        >
          Register Another Asset
        </button>
      </div>
    </div>
  );
}
