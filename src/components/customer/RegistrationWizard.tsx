import React, { useState } from 'react';
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
import { getPorts, getCompanyById, saveSubmission, saveCompany, saveUserRegistration, getAutoAssignedPorts } from '../../services/storage';
import { PortSelection } from './PortSelection';
import { TypeSelection } from './TypeSelection';
import { CompanyLookup } from './CompanyLookup';
import { CompanyForm } from './forms/CompanyForm';
import { DriverForm } from './forms/DriverForm';
import { TrailerForm } from './forms/TrailerForm';
import { VehicleForm } from './forms/VehicleForm';
import { ReviewScreen, SuccessScreen } from './ConfirmationScreen';
import { StatusTrackerModal } from './StatusTrackerModal';
import { Logo } from '../common/Logo';
import { Check, Search } from 'lucide-react';
import { HaulierGuidelinePage } from './HaulierGuidelinePage';
import { UserAccessForm, UserAccessFormData } from './forms/UserAccessForm';

interface RegistrationWizardProps {
  onSwitchToAdmin: () => void;
}

export function RegistrationWizard({ onSwitchToAdmin }: RegistrationWizardProps) {
  const [currentStep, setCurrentStep] = useState<number>(1);
  const [selectedLocation, setSelectedLocation] = useState<PortLocation | null>(null);
  const [selectedType, setSelectedType] = useState<RegistrationType | null>(null);
  const [selectedCompany, setSelectedCompany] = useState<Company | null>(null);

  // Form State
  const [companyFormData, setCompanyFormData] = useState<CompanyFormData | undefined>();
  const [userAccessFormData, setUserAccessFormData] = useState<UserAccessFormData | undefined>();
  const [driverFormDataList, setDriverFormDataList] = useState<DriverData[]>([]);
  const [trailerFormDataList, setTrailerFormDataList] = useState<TrailerData[]>([]);
  const [vehicleFormDataList, setVehicleFormDataList] = useState<VehicleData[]>([]);

  const [submittedRefNo, setSubmittedRefNo] = useState<string>('');
  const [showTrackerModal, setShowTrackerModal] = useState<boolean>(false);
  const [showGuideline, setShowGuideline] = useState<boolean>(false);

  const ports = getPorts();
  const currentPort = ports.find((p) => p.location === selectedLocation) || ports[0];

  // Steps definition
  // 1: Port
  // 2: Type
  // 3: Company Lookup (if not Company registration)
  // 4: Fill Details Form
  // 5: Review
  // 6: Success

  const handlePortSelect = (loc: PortLocation) => {
    setSelectedLocation(loc);
    // If switching to Port Klang, force type to COMPANY as other types are forbidden
    if (loc === 'PORT_KLANG') {
      setSelectedType('COMPANY');
    } else {
      setSelectedType(null);
    }
  };

  const handleAutoOpenPortKlang = () => {
    setSelectedLocation('PORT_KLANG');
    setSelectedType('COMPANY');
    setCurrentStep(4);
  };

  const handleTypeSelect = (type: RegistrationType) => {
    setSelectedType(type);
  };

  const handleCompanySubmit = (data: CompanyFormData) => {
    setCompanyFormData(data);
    setCurrentStep(5); // User access
  };

  const handleUserAccessSubmit = (data: UserAccessFormData) => {
    setUserAccessFormData(data);
    setCurrentStep(6); // Review
  };

  const handleDriverSubmit = (data: DriverData[]) => {
    setDriverFormDataList(data);
    setCurrentStep(5); // Review
  };

  const handleTrailerSubmit = (data: TrailerData[]) => {
    setTrailerFormDataList(data);
    setCurrentStep(5); // Review
  };

  const handleVehicleSubmit = (data: VehicleData[]) => {
    setVehicleFormDataList(data);
    setCurrentStep(5); // Review
  };

  const handleFinalConfirm = (refNo: string) => {
    if (!selectedLocation || !selectedType) return;

    // Build submission record
    let compId = selectedCompany?.id || '';
    let compName = selectedCompany?.name || '';
    let compReg = selectedCompany?.registration_number || '';
    let compType = selectedCompany?.company_type || '';

    let subByName = '';
    let subByEmail = '';
    let subByMobile = '';

    if (selectedType === 'COMPANY' && companyFormData) {
      compName = companyFormData.name;
      compReg = companyFormData.registration_number_old || companyFormData.registration_number;
      compType = companyFormData.company_type;
      subByName = companyFormData.contact_name || '';
      subByEmail = companyFormData.contact_email || '';
      subByMobile = companyFormData.contact_mobile || '';

      // Also create a company record in Company Master so future asset registrations can immediately find it!
      const newComp = saveCompany({
        name: companyFormData.name,
        short_name: companyFormData.short_name,
        company_type: companyFormData.company_type,
        registration_number: compReg,
        registration_number_old: companyFormData.registration_number_old,
        registration_number_new: companyFormData.registration_number_new,
        port_id: companyFormData.port_id,
        depot_id: companyFormData.depot_id,
        block: companyFormData.block,
        address1: companyFormData.address1,
        address2: companyFormData.address2,
        city: companyFormData.city,
        state: companyFormData.state,
        postcode: companyFormData.postcode,
        country: companyFormData.country,
        contact_name: companyFormData.contact_name,
        contact_email: companyFormData.contact_email,
        contact_designation: companyFormData.contact_designation,
        contact_mobile: companyFormData.contact_mobile,
        office_phone: companyFormData.office_phone,
        fax: companyFormData.fax,
        status: 'ACTIVE',
      });
      compId = newComp.id;
      if (userAccessFormData) {
        saveUserRegistration({
          ...userAccessFormData,
          type: 'COMPANY_ADMIN',
          company_id: newComp.id,
          company_name: newComp.name,
        });
      }
    } else {
      subByName = selectedCompany?.contact_name || 'Fleet Operator';
      subByEmail = selectedCompany?.contact_email || '';
      subByMobile = selectedCompany?.contact_mobile || '';
    }

    // Auto-assigned ports resolution
    const autoPorts = getAutoAssignedPorts(selectedLocation);

    // Save into central database
    saveSubmission({
      registration_type: selectedType,
      company_id: compId,
      company_reg_no: compReg,
      company_name: compName,
      company_type: compType,
      port_location: selectedLocation,
      port_id: autoPorts.backendIdsString,
      depot_id: selectedCompany?.depot_id,
      status: 'PENDING',
      submitted_by_name: subByName,
      submitted_by_email: subByEmail,
      submitted_by_mobile: subByMobile,
      data: {
        company: companyFormData,
        driver: driverFormDataList[0],
        drivers: driverFormDataList,
        trailer: trailerFormDataList[0],
        trailers: trailerFormDataList,
        vehicle: vehicleFormDataList[0],
        vehicles: vehicleFormDataList,
      },
    });

    setSubmittedRefNo(refNo);
    setCurrentStep(7); // Success
  };

  const handleReset = () => {
    setCurrentStep(1);
    setSelectedLocation(null);
    setSelectedType(null);
    setSelectedCompany(null);
    setCompanyFormData(undefined);
    setUserAccessFormData(undefined);
    setDriverFormDataList([]);
    setTrailerFormDataList([]);
    setVehicleFormDataList([]);
    setSubmittedRefNo('');
  };

  return (
    <div className="min-h-screen bg-[#f8fafc] flex flex-col">
      {showGuideline ? (
        <HaulierGuidelinePage onBack={() => setShowGuideline(false)} />
      ) : (
        <>
      {/* Top Navbar */}
      <header className="bg-[#0b1930] text-white border-b border-slate-800 sticky top-0 z-40">
        <div className="max-w-[1320px] mx-auto px-4 sm:px-8 lg:px-[44px] h-[54px] flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Logo size="md" light />
            <div className="hidden sm:flex items-center gap-4 pl-5 border-l border-slate-600/70 h-6">
              <span className="text-white text-sm sm:text-base font-semibold">Customer Registration</span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowTrackerModal(true)}
              className="inline-flex items-center justify-center gap-2 h-[30px] px-3 text-xs font-semibold rounded-md bg-transparent hover:bg-white/10 text-slate-100 border border-sky-500/80 transition-colors"
            >
              <Search className="w-3.5 h-3.5 text-[#0095e8]" />
              Track registration
            </button>
            <button
              type="button"
              onClick={onSwitchToAdmin}
              className="inline-flex items-center justify-center h-[30px] px-4 text-xs font-semibold rounded-md bg-[#0095e8] hover:bg-[#0078c8] text-white border border-[#0095e8] transition-colors"
            >
              Login
            </button>
          </div>
        </div>
      </header>

      {/* Progress Bar (visible during steps 1-5) */}
      {currentStep <= 5 && (
        <div className="h-[68px] flex items-center bg-white border-b border-[#e8eef5] px-4">
          <div className="max-w-[640px] mx-auto w-full flex items-center justify-between text-xs font-semibold">
            {[
              { num: 1, label: 'Port' },
              { num: 2, label: 'Registration Type' },
              { num: 3, label: 'Company Details' },
              { num: 4, label: selectedType === 'COMPANY' && currentStep === 5 ? 'User Access' : 'Review' },
            ].map((step, idx) => {
              const visualStep = currentStep === 1 ? 1 : currentStep <= 3 ? 2 : currentStep === 4 ? 3 : currentStep === 5 && selectedType === 'COMPANY' ? 4 : 4;
              const isPast = visualStep > step.num;
              const isCurrent = visualStep === step.num;

              return (
                <React.Fragment key={step.num}>
                  <div className="flex items-center gap-2">
                    <div className={`w-7 h-7 rounded-full flex items-center justify-center font-bold text-[11px] transition-colors ${
                      isPast ? 'bg-emerald-600 text-white' : isCurrent ? 'bg-[#0095e8] text-white ring-4 ring-sky-100' : 'bg-[#eef3f8] text-[#5b6b84]'
                    }`}>
                      {isPast ? <Check className="w-3.5 h-3.5" /> : step.num}
                    </div>
                    <span className={`hidden sm:inline whitespace-nowrap ${isCurrent ? 'text-[#102a56] font-bold' : 'text-[#5b6b84]'}`}>{step.label}</span>
                  </div>
                </React.Fragment>
              );
            })}
          </div>
        </div>
      )}

      {/* Main Content Area */}
      <main className="flex-1 max-w-[1080px] mx-auto w-full px-4 sm:px-6 lg:px-8 py-6 sm:py-7">
        {/* Step 1: Port Selection */}
        {currentStep === 1 && (
          <PortSelection
            selectedLocation={selectedLocation}
            onSelectLocation={handlePortSelect}
            ports={ports}
            onNext={() => setCurrentStep(2)}
            onSelectPortKlangDirect={handleAutoOpenPortKlang}
          />
        )}

        {/* Step 2: Registration Type Selection */}
        {currentStep === 2 && selectedLocation && (
          <TypeSelection
            location={selectedLocation}
            selectedType={selectedType}
            onSelectType={handleTypeSelect}
            onBack={() => setCurrentStep(1)}
            onNext={() => {
              if (selectedType === 'COMPANY') {
                setCurrentStep(4); // Skip company lookup
              } else {
                setCurrentStep(3); // Go to company lookup
              }
            }}
          />
        )}

        {/* Step 3: Company Lookup (for Driver / Trailer / Vehicle) */}
        {currentStep === 3 && selectedType && selectedType !== 'COMPANY' && (
          <CompanyLookup
            selectedCompany={selectedCompany}
            onSelectCompany={(comp) => setSelectedCompany(comp)}
            onBack={() => setCurrentStep(2)}
            onNext={() => setCurrentStep(4)}
            onRegisterNewCompany={() => {
              setSelectedType('COMPANY');
              setCurrentStep(4);
            }}
          />
        )}

        {/* Step 4: Asset Forms */}
        {currentStep === 4 && selectedType === 'COMPANY' && selectedLocation && (
          <CompanyForm
            initialLocation={selectedLocation}
            initialPortId={currentPort?.id}
            onSubmit={handleCompanySubmit}
            onBack={() => {
              if (selectedLocation === 'PORT_KLANG') {
                setCurrentStep(1);
              } else {
                setCurrentStep(2);
              }
            }}
          />
        )}

        {currentStep === 5 && selectedType === 'COMPANY' && companyFormData && (
          <UserAccessForm
            companyName={companyFormData.name}
            onSubmit={handleUserAccessSubmit}
            onBack={() => setCurrentStep(4)}
          />
        )}

        {currentStep === 4 && selectedType === 'DRIVER' && selectedCompany && currentPort && (
          <DriverForm
            company={selectedCompany}
            port={currentPort}
            onSubmit={handleDriverSubmit}
            onBack={() => setCurrentStep(3)}
          />
        )}

        {currentStep === 4 && selectedType === 'TRAILER' && selectedCompany && currentPort && (
          <TrailerForm
            company={selectedCompany}
            port={currentPort}
            onSubmit={handleTrailerSubmit}
            onBack={() => setCurrentStep(3)}
          />
        )}

        {currentStep === 4 && selectedType === 'VEHICLE' && selectedCompany && currentPort && (
          <VehicleForm
            company={selectedCompany}
            port={currentPort}
            onSubmit={handleVehicleSubmit}
            onBack={() => setCurrentStep(3)}
          />
        )}

        {/* Step 5: Review & Submit */}
        {((currentStep === 5 && selectedType !== 'COMPANY') || (currentStep === 6 && selectedType === 'COMPANY')) && selectedLocation && selectedType && (
          <ReviewScreen
            location={selectedLocation}
            port={currentPort}
            type={selectedType}
            company={selectedCompany}
            formData={{
              company: companyFormData,
              driver: driverFormDataList[0],
              drivers: driverFormDataList,
              trailer: trailerFormDataList[0],
              trailers: trailerFormDataList,
              vehicle: vehicleFormDataList[0],
              vehicles: vehicleFormDataList,
            }}
            onBack={() => setCurrentStep(4)}
            onSubmitSuccess={handleFinalConfirm}
          />
        )}

        {/* Step 6: Confirmation Screen */}
        {currentStep === 7 && selectedType && (
          <SuccessScreen
            referenceNo={submittedRefNo}
            type={selectedType}
            onReset={handleReset}
            onViewTracker={() => setShowTrackerModal(true)}
          />
        )}
      </main>

      {/* Footer */}
      <footer className="h-12 shrink-0 border-t border-slate-200 bg-white">
        <div className="h-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-wrap items-center justify-center gap-x-3 gap-y-0.5 text-[11px] leading-4 text-slate-500">
          <span className="font-semibold text-slate-700">Contact for help</span>
          <span className="hidden sm:inline text-slate-300">|</span>
          <span>+60 3277 12765</span>
          <span className="hidden sm:inline text-slate-300">|</span>
          <span>support@cargomove.com.my</span>
          <span className="hidden sm:inline text-slate-300">|</span>
          <span className="font-semibold text-emerald-700">WHATSAPP: +6018 266 0085 (FASTER RESPONSE)</span>
        </div>
      </footer>

      {/* Tracker Modal */}
      <StatusTrackerModal
        isOpen={showTrackerModal}
        onClose={() => setShowTrackerModal(false)}
        initialRef={submittedRefNo}
      />
        </>
      )}
    </div>
  );
}
