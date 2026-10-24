import type { Company, RegistrationSubmission } from '../src/types/index.js';

export const COMPANY_REGISTRATION_REQUIRED = 'Register the parent company before processing its drivers, trailers or vehicles. Company registration status must be Registered.';

export function latestCompanyRegistration(companyId: string, submissions: RegistrationSubmission[]) {
  return submissions.filter(item => item.registration_type === 'COMPANY' && item.company_id === companyId)
    .sort((left, right) => (Date.parse(right.submitted_at) || 0) - (Date.parse(left.submitted_at) || 0)
      || (right.id > left.id ? 1 : right.id < left.id ? -1 : 0))[0];
}

export function companyRegistrationStatus(company: Company, submissions: RegistrationSubmission[]) {
  return latestCompanyRegistration(company.id, submissions)?.status || company.registration_status || 'PENDING';
}

export function normalizeCompanyRegistrationStatus(value: unknown) {
  const status = String(value || '').trim().toUpperCase();
  if (status === 'REGISTERED' || status === 'DONE') return 'DONE' as const;
  if (status === 'PENDING' || status === 'REJECTED') return status;
  throw new Error('Registration status must be Pending, Registered (Done), or Rejected.');
}

/** Queue approval overrides a master edit; imported companies can be confirmed without a queue. */
export function assetCompanyBlockReason(
  submission: Pick<RegistrationSubmission, 'registration_type' | 'company_id'>,
  company: Company | undefined,
  submissions: RegistrationSubmission[],
): string | null {
  if (submission.registration_type === 'COMPANY') return null;
  if (!company) return COMPANY_REGISTRATION_REQUIRED;
  return companyRegistrationStatus(company, submissions) === 'DONE' ? null : COMPANY_REGISTRATION_REQUIRED;
}
