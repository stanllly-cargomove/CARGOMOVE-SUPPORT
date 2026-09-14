import type { Company, CompanyFormData, RegistrationSubmission } from '../types';
import type { UserAccessFormData } from '../components/customer/forms/UserAccessForm';

export interface RegistrationRequest {
  registration_type: RegistrationSubmission['registration_type'];
  port_location: RegistrationSubmission['port_location'];
  port_id: string;
  depot_id?: string;
  company_id?: string;
  company_reg_no?: string;
  company_name?: string;
  company_type?: string;
  submitted_by_name?: string;
  submitted_by_email?: string;
  submitted_by_mobile?: string;
  company?: CompanyFormData;
  user_access?: UserAccessFormData;
  data: RegistrationSubmission['data'];
}

export interface RegistrationTracking {
  reference_no: string;
  registration_type: RegistrationSubmission['registration_type'];
  company_name: string;
  port_location: RegistrationSubmission['port_location'];
  status: 'PENDING' | 'SUCCESS' | 'REJECTED';
  submission_status: RegistrationSubmission['status'];
  user_email_sent: boolean;
  submitted_at: string;
  completed_at?: string | null;
  updated_at: string;
}

export async function lookupRegisteredCompany(registrationNumber: string): Promise<Company | null> {
  const query = new URLSearchParams({ registration_number: registrationNumber });
  const response = await fetch(`/api/company-lookup?${query.toString()}`, { cache: 'no-store' });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || 'Unable to verify the company.');
  return body.company || null;
}

export async function submitRegistration(input: RegistrationRequest): Promise<{
  company: Company | null;
  submission: RegistrationSubmission;
}> {
  const response = await fetch('/api/company-registration', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || 'Unable to save the registration.');
  return { company: body.company || null, submission: body.submission };
}

export async function trackRegistration(referenceNo: string): Promise<RegistrationTracking | null> {
  const query = new URLSearchParams({ reference_no: referenceNo.trim().toUpperCase() });
  const response = await fetch(`/api/registration-status?${query.toString()}`, { cache: 'no-store' });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || 'Unable to check the registration status.');
  return body.tracking || null;
}
