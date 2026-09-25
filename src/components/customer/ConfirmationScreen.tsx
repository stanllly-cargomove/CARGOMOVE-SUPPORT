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
  Copy,
  Check,
  RefreshCw,
  MapPin,
  Send,
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
  onSubmitSuccess: (consent: { declarationAccepted: boolean; dataProcessingAccepted: boolean }) => Promise<string>;
}

export function ReviewScreen({
  location,
  port,
  type,
  company,
  formData,
  onBack,
  onSubmitSuccess,
}: ReviewAndSubmitProps) {
  const [declarationAccepted, setDeclarationAccepted] = useState(false);
  const [dataProcessingAccepted, setDataProcessingAccepted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const touchStartX = useRef<number | null>(null);
  const categoryTitle = type === 'COMPANY'
    ? 'Company Master Onboarding'
    : type === 'DRIVER'
    ? 'Driver Gate Access'
    : type === 'TRAILER'
    ? 'Trailer / Chassis Registration'
    : 'Prime Mover / Vehicle Registration';
  const locationLabel = location === 'PORT_KLANG' ? 'Port Klang' : location === 'JOHOR' ? 'Johor' : port.display_name;

  const handleSubmit = async () => {
    if (!declarationAccepted || !dataProcessingAccepted) return;
    setSubmitting(true);
    setSubmitError('');
    try {
      await onSubmitSuccess({ declarationAccepted, dataProcessingAccepted });
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
      className="mx-auto flex max-w-5xl flex-col gap-3 touch-pan-y page-slide-forward"
    >
      <div className="w-full shrink-0 text-center">
        <h2 className="text-lg font-bold tracking-tight text-[#102a56]">Review & Confirm Submission</h2>
        <p className="mt-0.5 text-[11px] text-slate-500">
          Check the information below before submitting your registration.
        </p>
      </div>

      <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm sm:p-4">
        {/* Header Summary */}
        <div className="flex flex-col gap-3 border-b border-slate-100 pb-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="truncate text-sm font-bold text-[#102a56]">{categoryTitle}</div>
            <div className="mt-0.5 text-[11px] text-slate-500">Please check your registration and account details.</div>
          </div>

          <div className="self-end sm:self-auto">
            <div className="rounded-lg bg-sky-50 px-3 py-2">
              <div className="text-[9px] font-bold uppercase tracking-wider text-slate-400">Port location</div>
              <div className="mt-0.5 flex items-center gap-1 text-xs font-bold text-[#0090e7]">
                <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
                {locationLabel}
              </div>
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
          <div className="grid gap-2 text-xs lg:grid-cols-[minmax(0,2fr)_minmax(220px,1fr)]">
            <section className="rounded-lg border border-sky-100 bg-sky-50/50 p-3">
              <h3 className="mb-2 flex items-center gap-2 border-b border-sky-100 pb-2 text-xs font-bold text-[#102a56]">
                <Building2 className="h-4 w-4 text-blue-600" aria-hidden="true" /> Company Details
              </h3>
              <div className="grid grid-cols-1 gap-x-5 md:grid-cols-2">
                <div className="min-w-0 space-y-2">
                  <div className="grid grid-cols-[94px_minmax(0,1fr)] gap-2">
                    <span className="text-[10px] font-bold text-slate-900">Legal Name</span>
                    <span className="break-words text-[10px] text-slate-600">{formData.company.name}</span>
                  </div>
                  <div className="grid grid-cols-[94px_minmax(0,1fr)] gap-2">
                    <span className="text-[10px] font-bold text-slate-900">Short Name</span>
                    <span className="break-words text-[10px] text-slate-600">{formData.company.short_name}</span>
                  </div>
                  <div className="grid grid-cols-[94px_minmax(0,1fr)] gap-2">
                    <span className="text-[10px] font-bold text-slate-900">Company Type</span>
                    <span className="text-[10px] text-slate-600">{formData.company.company_type}</span>
                  </div>
                  <div className="grid grid-cols-[94px_minmax(0,1fr)] gap-2">
                    <span className="text-[10px] font-bold text-slate-900">Registration</span>
                    <span className="break-words text-[10px] text-slate-600">
                      {formData.company.registration_number_old} {formData.company.registration_number_new ? `/ ${formData.company.registration_number_new}` : ''}
                    </span>
                  </div>
                </div>
                <div className="mt-2 min-w-0 space-y-2 border-t border-sky-100 pt-2 md:mt-0 md:border-l md:border-t-0 md:pl-5 md:pt-0">
                  <div className="grid grid-cols-[94px_minmax(0,1fr)] gap-2">
                    <span className="text-[10px] font-bold text-slate-900">Registered Address</span>
                    <span className="break-words text-[10px] leading-4 text-slate-600">
                      {formData.company.block ? `${formData.company.block}, ` : ''}
                      {formData.company.address1}, {formData.company.address2 ? `${formData.company.address2}, ` : ''}
                      {formData.company.city}, {formData.company.state} {formData.company.postcode}, {formData.company.country}
                    </span>
                  </div>
                  <div className="grid grid-cols-[94px_minmax(0,1fr)] gap-2">
                    <span className="text-[10px] font-bold text-slate-900">Contact Person</span>
                    <span className="break-words text-[10px] text-slate-600">
                      {formData.company.contact_name}
                      {formData.company.contact_designation ? ` (${formData.company.contact_designation})` : ''}
                    </span>
                  </div>
                  <div className="grid grid-cols-[94px_minmax(0,1fr)] gap-2">
                    <span className="text-[10px] font-bold text-slate-900">PIC Contact</span>
                    <span className="break-words text-[10px] leading-4 text-slate-600">
                      {formData.company.contact_email} &bull; {formData.company.contact_mobile}
                      {formData.company.office_phone ? ` &bull; Office: ${formData.company.office_phone}` : ''}
                      {formData.company.fax ? ` &bull; Fax: ${formData.company.fax}` : ''}
                    </span>
                  </div>
                </div>
              </div>
            </section>
            {formData.userAccess && (
              <section className="rounded-lg border border-emerald-100 bg-emerald-50/50 p-3">
                <h3 className="mb-2 flex items-center gap-2 border-b border-emerald-100 pb-2 text-xs font-bold text-[#102a56]">
                  <User className="h-4 w-4 text-emerald-600" aria-hidden="true" /> Login Account
                </h3>
                <div className="grid grid-cols-1 gap-y-2">
                  <div className="grid grid-cols-[90px_minmax(0,1fr)] gap-2">
                    <span className="text-[10px] font-bold text-slate-900">Username</span>
                    <span className="break-words text-[10px] text-slate-600">{formData.userAccess.username}</span>
                  </div>
                  <div className="grid grid-cols-[90px_minmax(0,1fr)] gap-2">
                    <span className="text-[10px] font-bold text-slate-900">Full Name</span>
                    <span className="break-words text-[10px] text-slate-600">{formData.userAccess.full_name}</span>
                  </div>
                  <div className="grid grid-cols-[90px_minmax(0,1fr)] gap-2">
                    <span className="text-[10px] font-bold text-slate-900">Email</span>
                    <span className="break-words text-[10px] text-slate-600">{formData.userAccess.email}</span>
                  </div>
                  <div className="grid grid-cols-[90px_minmax(0,1fr)] gap-2">
                    <span className="text-[10px] font-bold text-slate-900">Mobile Number</span>
                    <span className="break-words text-[10px] text-slate-600">{formData.userAccess.mobile_number}</span>
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

        {/* Required declarations */}
        <fieldset className="grid gap-2 rounded-lg bg-slate-50 p-3 md:grid-cols-2 md:gap-4">
          <legend className="sr-only">Required submission declarations</legend>
          <label className="flex cursor-pointer items-start gap-2.5 text-[11px] leading-4 text-slate-600">
            <input
              type="checkbox"
              required
              checked={declarationAccepted}
              onChange={(event) => setDeclarationAccepted(event.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300 text-sky-600 focus:ring-sky-500"
            />
            <span>
              I declare that the information submitted above is true, accurate, and authorized by company management.
            </span>
          </label>
          <label className="flex cursor-pointer items-start gap-2.5 text-[11px] leading-4 text-slate-600">
            <input
              type="checkbox"
              required
              checked={dataProcessingAccepted}
              onChange={(event) => setDataProcessingAccepted(event.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300 text-sky-600 focus:ring-sky-500"
            />
            <span>
              I consent to CargoMove collecting, using, storing, and processing the submitted company and personal data for registration verification, account administration, operational support, and related communications. I confirm that I am authorized to provide this data.
            </span>
          </label>
        </fieldset>
      </div>

      <div className="mt-auto flex shrink-0 flex-col-reverse gap-2 sm:flex-row sm:items-end sm:justify-between">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex h-10 items-center justify-center gap-1.5 rounded-lg px-3.5 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-100 sm:justify-start"
        >
          &larr; Back to Edit
        </button>

        <div className="sm:text-right">
          <button
            type="button"
            disabled={!declarationAccepted || !dataProcessingAccepted || submitting}
            onClick={handleSubmit}
            className="inline-flex h-11 w-full items-center justify-center rounded-lg bg-gradient-to-r from-orange-500 to-orange-600 px-6 text-xs font-bold text-white shadow-sm transition-colors hover:from-orange-600 hover:to-orange-700 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
          >
            {submitting ? (
              <>
                <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                Submitting...
              </>
            ) : (
              <>
                <Send className="mr-2 h-4 w-4" aria-hidden="true" />
                Confirm & Submit Registration
              </>
            )}
          </button>
          <p className="mt-1 text-[10px] text-slate-400">Your registration will be sent to our team for processing.</p>
        </div>
      </div>
      {submitError && (
        <div role="alert" className="rounded border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
          <p className="font-bold">Registration could not be submitted</p>
          <p className="mt-1 whitespace-pre-line leading-5">{submitError}</p>
        </div>
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
