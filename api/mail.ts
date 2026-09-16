import supportAnalyze from '../server-handlers/ai/analyze.js';
import supportAnalysis from '../server-handlers/ai/analysis.js';
import supportCases from '../server-handlers/support/cases.js';
import supportCase from '../server-handlers/support/case.js';
import supportStats from '../server-handlers/support/stats.js';
import emailLogs from '../server-handlers/email/logs.js';
import emailAttachments from '../server-handlers/email/attachments.js';
import emailPreview from '../server-handlers/email/preview.js';
import emailSend from '../server-handlers/email/send.js';
import emailTemplates from '../server-handlers/email/templates.js';
import gmailCallback from '../server-handlers/gmail/callback.js';
import gmailConnect from '../server-handlers/gmail/connect.js';
import gmailStatus from '../server-handlers/gmail/status.js';

import gmailMessages from '../server-handlers/gmail/messages.js';
import gmailMessage from '../server-handlers/gmail/message.js';
import gmailThread from '../server-handlers/gmail/thread.js';
import gmailSync from '../server-handlers/gmail/sync.js';

type Handler = (request: any, response: any) => unknown;

const handlers: Record<string, Handler> = {
  'POST support/analyze': supportAnalyze,
  'GET support/analysis': supportAnalysis,
  'GET support/cases': supportCases,
  'GET support/case': supportCase,
  'GET support/stats': supportStats,
  'GET email/logs': emailLogs,
  'POST email/attachments': emailAttachments,
  'POST email/preview': emailPreview,
  'POST email/send': emailSend,
  'GET email/templates': emailTemplates,
  'POST email/templates': emailTemplates,
  'PUT email/templates': emailTemplates,
  'DELETE email/templates': emailTemplates,
  'GET gmail/callback': gmailCallback,
  'POST gmail/connect': gmailConnect,
  'GET gmail/status': gmailStatus,
  'GET gmail/messages': gmailMessages,
  'GET gmail/message': gmailMessage,
  'GET gmail/thread': gmailThread,
  'POST gmail/sync': gmailSync,
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
  try {
    await handler(request, response);
  } catch (error) {
    console.error(`Email API route failed (${route}):`, error);
    if (!response.headersSent) {
      response.status(500).json({ error: 'Email service error. Check the Vercel function logs.' });
    }
  }
}
