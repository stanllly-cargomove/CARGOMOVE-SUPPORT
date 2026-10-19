import companyLookup from '../server-handlers/registration/lookup.js';
import companyRegistration from '../server-handlers/registration/submit.js';
import registrationStatus from '../server-handlers/registration/status.js';
import registrationConfig from '../server-handlers/registration/config.js';

const routes: Record<string, (request: any, response: any) => Promise<void>> = {
  config: registrationConfig,
  lookup: companyLookup,
  status: registrationStatus,
  submit: companyRegistration,
};

// Keep registration operations in one Serverless Function. Vercel rewrites the
// existing public URLs to this dispatcher, so frontend callers do not change.
export default async function registration(request: any, response: any) {
  const route = String(request.query?.route || '').trim().toLowerCase();
  const handler = Object.hasOwn(routes, route) ? routes[route] : undefined;
  if (!handler) {
    response.status(404).json({ error: 'Unknown registration API route.' });
    return;
  }
  await handler(request, response);
}
