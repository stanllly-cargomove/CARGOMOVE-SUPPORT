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
