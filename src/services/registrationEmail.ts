import { ExternalUserAccess } from './auth';

/**
 * Placeholder for the registration email integration.
 * The registration screen currently records only the sent flag; no email is sent yet.
 */
export async function sendRegistrationEmail(_user: ExternalUserAccess): Promise<void> {
  // Intentionally empty until an email provider is selected.
}
