import type { RegistrationSubmission } from '../src/types/index.js';

export function registrationFilename(submissions: Pick<RegistrationSubmission, 'reference_no' | 'registration_type'>[], windowsSafe = false) {
  if (!submissions.length) throw new Error('Select registrations to generate Excel.');
  const references = [...new Set(submissions.map(sub => sub.reference_no))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const range = references.length === 1 ? references[0] : `${references[0]} - ${references.at(-1)}`;
  const filename = `${range}_${submissions[0].registration_type}_ BY:cargomove-register.vercel.app.xlsx`;
  return windowsSafe ? filename.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-') : filename;
}
