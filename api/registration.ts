import companyLookup from '../server-handlers/registration/lookup.js';
import companyRegistration from '../server-handlers/registration/submit.js';
import registrationStatus from '../server-handlers/registration/status.js';

const routes: Record<string, (request: any, response: any) => Promise<void>> = {
  lookup: companyLookup,
  status: registrationStatus,
  submit: companyRegistration,
};

// Keep registration operations in one Serverless Function. Vercel rewrites the
// existing public URLs to this dispatcher, so frontend callers do not change.
export default async function registration(request: any, response: any) {
  const route = String(request.query?.route || '').trim().toLowerCase();
  const handler = routes[route];
  if (!handler) {
    response.status(404).json({ error: 'Unknown registration API route.' });
    return;
  }
  await handler(request, response);
}
