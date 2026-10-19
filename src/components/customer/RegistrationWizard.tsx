import React, { useState } from 'react';
import { Toaster } from 'react-hot-toast';
import {
  PortLocation,
  RegistrationType,
  Company,
  CompanyFormData,
  DriverData,
  TrailerData,
  VehicleData,
} from '../../types';
import { cacheSavedRegistration, getPorts, getAutoAssignedPorts } from '../../services/storage';
import { submitRegistration } from '../../services/registration';
import { PortSelection } from './PortSelection';
import { TypeSelection } from './TypeSelection';
import { CompanyLookup } from './CompanyLookup';
import { CompanyForm } from './forms/CompanyForm';
import { DriverForm } from './forms/DriverForm';
import { TrailerForm } from './forms/TrailerForm';
import { VehicleForm } from './forms/VehicleForm';
import { ReviewScreen, SuccessScreen } from './ConfirmationScreen';

import { Check } from 'lucide-react';

import { UserAccessForm, UserAccessFormData } from './forms/UserAccessForm';

interface RegistrationWizardProps {
  onTrackStatus: (reference?: string) => void;
}

export function RegistrationWizard({ onTrackStatus }: RegistrationWizardProps) {
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

  const ports = getPorts();
  const currentPort = ports.find((p) => p.location === selectedLocation) || ports[0];
  const reviewStep = selectedType === 'COMPANY' ? 6 : 5;
  const isReviewScreen = currentStep === reviewStep;
  const isLandingStep = currentStep === 1;
  const activeProgressStep = currentStep === 1
    ? 1
    : currentStep <= 3
    ? 2
    : currentStep === 4
    ? 3
    : selectedType === 'COMPANY' && currentStep === 5
    ? 4
    : selectedType === 'COMPANY' && currentStep === 6
    ? 5
    : 4;
  const progressSteps = [
    { num: 1, label: 'Port' },
    { num: 2, label: 'Registration Type' },
    { num: 3, label: selectedType === 'COMPANY' ? 'Company Details' : 'Asset Details' },
    ...(selectedType === 'COMPANY' && currentStep >= 5 ? [{ num: 4, label: 'User Access' }] : []),
    ...(currentStep >= reviewStep
      ? [{ num: selectedType === 'COMPANY' ? 5 : 4, label: 'Review Registration' }]
      : []),
  ];

  // Steps definition
  // 1: Port
  // 2: Type
  // 3: Company Lookup (if not Company registration)
  // 4: Fill Details Form
  // 5: Review
  // 6: Success

  const handlePortSelect = (loc: PortLocation) => {
    if (loc !== selectedLocation) {
      setCompanyFormData(undefined);
      setUserAccessFormData(undefined);
      setSelectedCompany(null);
      setDriverFormDataList([]);
      setTrailerFormDataList([]);
      setVehicleFormDataList([]);
    }
    setSelectedLocation(loc);
    // If switching to Port Klang, force type to COMPANY as other types are forbidden
    if (loc === 'PORT_KLANG') {
      setSelectedType('COMPANY');
    } else {
      setSelectedType(null);
    }
  };

  const handleAutoOpenPortKlang = () => {
    handlePortSelect('PORT_KLANG');
    setSelectedType('COMPANY');
    setCurrentStep(4);
  };

  const handleTypeSelect = (type: RegistrationType) => {
    if (type === 'COMPANY') setSelectedCompany(null);
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

  const handleFinalConfirm = async (
    consent: { declarationAccepted: boolean; dataProcessingAccepted: boolean },
    emailConfirmation?: { additionalEmail?: string },
  ): Promise<string> => {
    if (!selectedLocation || !selectedType) throw new Error('Registration details are incomplete.');

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
    } else {
      subByName = selectedCompany?.contact_name || 'Fleet Operator';
      subByEmail = selectedCompany?.contact_email || '';
      subByMobile = selectedCompany?.contact_mobile || '';
    }

    // Auto-assigned ports resolution
    const autoPorts = getAutoAssignedPorts(selectedLocation);

    const selectedPortIds = selectedType === 'COMPANY'
      ? companyFormData?.assigned_port_ids || []
      : [];
    const primaryPortId = selectedType === 'COMPANY' && selectedLocation === 'PORT_KLANG'
      ? selectedPortIds[0]
      : autoPorts.ports[0]?.id || currentPort?.id;
    if (!primaryPortId) throw new Error('No database port is configured for this location.');

    const result = await submitRegistration({
      registration_type: selectedType,
      company_id: compId || undefined,
      company_reg_no: compReg,
      company_name: compName,
      company_type: compType,
      port_location: selectedLocation,
      port_id: primaryPortId,
      depot_id: selectedType === 'COMPANY' ? companyFormData?.depot_id : selectedCompany?.depot_id,
      submitted_by_name: subByName,
      submitted_by_email: subByEmail,
      submitted_by_mobile: subByMobile,
      additional_confirmation_email: emailConfirmation?.additionalEmail,
      declaration_accepted: consent.declarationAccepted,
      data_processing_consent: consent.dataProcessingAccepted,
      company: selectedType === 'COMPANY' && companyFormData
        ? { ...companyFormData, registration_number: compReg, port_id: primaryPortId }
        : undefined,
      user_access: selectedType === 'COMPANY' ? userAccessFormData : undefined,
      data: {
        company: selectedType === 'COMPANY' ? companyFormData : undefined,
        driver: selectedType === 'DRIVER' ? driverFormDataList[0] : undefined,
        drivers: selectedType === 'DRIVER' ? driverFormDataList : [],
        trailer: selectedType === 'TRAILER' ? trailerFormDataList[0] : undefined,
        trailers: selectedType === 'TRAILER' ? trailerFormDataList : [],
        vehicle: selectedType === 'VEHICLE' ? vehicleFormDataList[0] : undefined,
        vehicles: selectedType === 'VEHICLE' ? vehicleFormDataList : [],
      },
    });

    cacheSavedRegistration(result.company, result.submission);
    setSubmittedRefNo(result.submission.reference_no);
    setCurrentStep(7); // Success
    return result.submission.reference_no;
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
    <div className={`customer-theme min-h-screen flex flex-col ${isLandingStep ? 'bg-white' : 'bg-[#f8fafc]'}`}>
      <div className={`${isLandingStep ? 'bg-[#f8fafc]' : ''} flex flex-1 flex-col`}>
      {/* Progress Bar (visible through the Review screen) */}
      {currentStep <= reviewStep && (
        <div className="min-h-[68px] border-0 bg-transparent flex items-center px-2 py-2 sm:px-4">
          <div className="mx-auto flex w-full max-w-[880px] items-start text-xs font-semibold sm:items-center">
            {progressSteps.map((step, idx) => {
              const isPast = activeProgressStep > step.num;
              const isCurrent = activeProgressStep === step.num;

              return (
                <React.Fragment key={step.num}>
                  <div className="flex min-w-0 shrink-0 flex-col items-center gap-1 text-center sm:flex-row sm:gap-2 sm:text-left">
                    <div className={`h-7 w-7 shrink-0 rounded-full flex items-center justify-center font-bold text-[11px] transition-colors ${
                      isPast ? 'bg-emerald-600 text-white' : isCurrent ? 'bg-[#0095e8] text-white ring-4 ring-sky-100' : 'bg-[#eef3f8] text-[#395274]'
                    }`}>
                      {isPast ? <Check className="w-3.5 h-3.5" /> : step.num}
                    </div>
                    <span className={`max-w-[76px] text-[9px] leading-3 sm:max-w-none sm:whitespace-nowrap sm:text-xs ${isCurrent ? 'text-[#102a56] font-bold' : 'text-[#5b6b84]'}`}>
                      {step.label}
                    </span>
                  </div>
                  {idx < progressSteps.length - 1 && (
                    <div className={`mx-2 mt-3.5 h-px min-w-2 flex-1 sm:mt-0 lg:mx-4 ${isPast ? 'bg-emerald-200' : 'bg-slate-300'}`} aria-hidden="true" />
                  )}
                </React.Fragment>
              );
            })}
          </div>
        </div>
      )}

      {/* Main Content Area */}
      <div
        className={`cm-wizard-content ${isLandingStep ? 'max-w-none flex items-center py-6 sm:py-7' : `max-w-[1080px] px-4 sm:px-6 lg:px-8 ${isReviewScreen ? 'py-3 sm:py-4' : 'py-6 sm:py-7'}`} flex-1 mx-auto w-full`}
      >
        <div key={currentStep} className={`${isLandingStep ? 'mx-auto w-full max-w-[1080px] -translate-y-5 px-4 sm:-translate-y-7 sm:px-6 lg:px-8 ' : ''}wizard-step-enter`}>
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
            onSelectCompany={(comp) => {
              if (comp && comp.id !== selectedCompany?.id) {
                setDriverFormDataList([]);
                setTrailerFormDataList([]);
                setVehicleFormDataList([]);
              }
              setSelectedCompany(comp);
            }}
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
            initialData={companyFormData}
            initialPage={companyFormData ? 3 : 1}
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
            initialData={userAccessFormData}
            onSubmit={handleUserAccessSubmit}
            onBack={() => setCurrentStep(4)}
          />
        )}

        {currentStep === 4 && selectedType === 'DRIVER' && selectedCompany && currentPort && (
          <DriverForm
            initialData={driverFormDataList}
            company={selectedCompany}
            port={currentPort}
            onSubmit={handleDriverSubmit}
            onBack={() => setCurrentStep(3)}
          />
        )}

        {currentStep === 4 && selectedType === 'TRAILER' && selectedCompany && currentPort && (
          <TrailerForm
            initialData={trailerFormDataList}
            company={selectedCompany}
            port={currentPort}
            onSubmit={handleTrailerSubmit}
            onBack={() => setCurrentStep(3)}
          />
        )}

        {currentStep === 4 && selectedType === 'VEHICLE' && selectedCompany && currentPort && (
          <VehicleForm
            initialData={vehicleFormDataList}
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
              userAccess: userAccessFormData,
              driver: selectedType === 'DRIVER' ? driverFormDataList[0] : undefined,
              drivers: selectedType === 'DRIVER' ? driverFormDataList : [],
              trailer: selectedType === 'TRAILER' ? trailerFormDataList[0] : undefined,
              trailers: selectedType === 'TRAILER' ? trailerFormDataList : [],
              vehicle: selectedType === 'VEHICLE' ? vehicleFormDataList[0] : undefined,
              vehicles: selectedType === 'VEHICLE' ? vehicleFormDataList : [],
            }}
            onBack={() => setCurrentStep(selectedType === 'COMPANY' ? 5 : 4)}
            onSubmitSuccess={handleFinalConfirm}
          />
        )}

        {/* Step 6: Confirmation Screen */}
        {currentStep === 7 && selectedType && (
          <SuccessScreen
            referenceNo={submittedRefNo}
            type={selectedType}
            onReset={handleReset}
            onViewTracker={() => onTrackStatus(submittedRefNo)}
          />
        )}
        </div>
      </div>
      </div>

      <Toaster
        position="top-center"
        gutter={10}
        containerStyle={{ top: 16 }}
        toastOptions={{ duration: 4000 }}
      />

    </div>
  );
}
