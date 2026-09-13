import emailLogs from '../server-handlers/email/logs';
import emailPreview from '../server-handlers/email/preview';
import emailSend from '../server-handlers/email/send';
import emailTemplates from '../server-handlers/email/templates';
import gmailCallback from '../server-handlers/gmail/callback';
import gmailConnect from '../server-handlers/gmail/connect';
import gmailStatus from '../server-handlers/gmail/status';

type Handler = (request: any, response: any) => unknown;

const handlers: Record<string, Handler> = {
  'GET email/logs': emailLogs,
  'POST email/preview': emailPreview,
  'POST email/send': emailSend,
  'GET email/templates': emailTemplates,
  'PUT email/templates': emailTemplates,
  'GET gmail/callback': gmailCallback,
  'POST gmail/connect': gmailConnect,
  'GET gmail/status': gmailStatus,
};

/**
 * A single explicit Vercel Function for the complete email integration. The
 * route is supplied by vercel.json so Gmail does not consume one function per
 * endpoint on the Hobby plan.
 */
export default async function mailRouter(request: any, response: any) {
  const routeValue = Array.isArray(request.query?.route)
    ? request.query.route.join('/')
    : String(request.query?.route || '');
  const route = routeValue.replace(/^\/+|\/+$/g, '');
  const handler = handlers[`${String(request.method || 'GET').toUpperCase()} ${route}`];
  if (!handler) {
    response.status(404).json({ error: 'Unknown email API route.' });
    return;
  }
  await handler(request, response);
}
