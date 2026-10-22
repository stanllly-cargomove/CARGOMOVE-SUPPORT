import emailLogs from '../server-handlers/email/logs.js';
import emailAttachments from '../server-handlers/email/attachments.js';
import emailPreview from '../server-handlers/email/preview.js';
import emailSend from '../server-handlers/email/send.js';
import submissionPreview from '../server-handlers/email/submission-preview.js';
import submissionSend from '../server-handlers/email/submission-send.js';
import submissionBatchPreview from '../server-handlers/email/submission-batch-preview.js';
import submissionBatchSend from '../server-handlers/email/submission-batch-send.js';
import submissionAttachment from '../server-handlers/email/submission-attachment.js';
import emailTemplates from '../server-handlers/email/templates.js';
import gmailCallback from '../server-handlers/gmail/callback.js';
import gmailConnect from '../server-handlers/gmail/connect.js';
import gmailStatus from '../server-handlers/gmail/status.js';
import autoMailStatus from '../server-handlers/auto-mail/status.js';
import agentSettings from '../server-handlers/auto-mail/agent-settings.js';
import { attachmentUpload, attachmentRead, attachmentRemove } from '../server-handlers/auto-mail/attachments.js';
import { learningList, learningDetail, learningPropose, learningReview } from '../server-handlers/auto-mail/learning.js';
import { aiGenerate, aiUse } from '../server-handlers/auto-mail/ai.js';
import { knowledgeList, knowledgeDetail, knowledgeSave, knowledgeReview, knowledgeMatches } from '../server-handlers/auto-mail/knowledge.js';
import { gmailConnect as autoMailConnect, gmailCallback as autoMailCallback, gmailThreads, gmailThread, gmailReply } from '../server-handlers/auto-mail/gmail.js';


type Handler = (request: any, response: any) => unknown;

const handlers: Record<string, Handler> = {
  'GET auto-mail/status': autoMailStatus,
  'POST auto-mail/attachment-upload': attachmentUpload,
  'GET auto-mail/attachment': attachmentRead,
  'POST auto-mail/attachment-remove': attachmentRemove,
  'GET auto-mail/agent-settings': agentSettings,
  'POST auto-mail/agent-settings': agentSettings,
  'GET auto-mail/learning': learningList,
  'GET auto-mail/learning-suggestion': learningDetail,
  'POST auto-mail/learning-propose': learningPropose,
  'POST auto-mail/learning-review': learningReview,
  'POST auto-mail/ai-generate': aiGenerate,
  'POST auto-mail/ai-use': aiUse,
  'GET auto-mail/knowledge': knowledgeList,
  'POST auto-mail/knowledge': knowledgeSave,
  'GET auto-mail/knowledge-article': knowledgeDetail,
  'POST auto-mail/knowledge-review': knowledgeReview,
  'POST auto-mail/knowledge-matches': knowledgeMatches,
  'POST auto-mail/connect': autoMailConnect,
  'GET auto-mail/callback': autoMailCallback,
  'GET auto-mail/threads': gmailThreads,
  'GET auto-mail/thread': gmailThread,
  'POST auto-mail/reply': gmailReply,
  'GET email/logs': emailLogs,
  'POST email/attachments': emailAttachments,
  'POST email/preview': emailPreview,
  'POST email/send': emailSend,
  'POST email/submission-preview': submissionPreview,
  'POST email/submission-send': submissionSend,
  'POST email/submission-batch-preview': submissionBatchPreview,
  'POST email/submission-batch-send': submissionBatchSend,
  'GET email/submission-attachment': submissionAttachment,
  'GET email/templates': emailTemplates,
  'POST email/templates': emailTemplates,
  'PUT email/templates': emailTemplates,
  'DELETE email/templates': emailTemplates,
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
  try {
    await handler(request, response);
  } catch (error) {
    console.error(`Email API route failed (${route}):`, error);
    if (!response.headersSent) {
      response.status(500).json({ error: 'Email service error. Check the Vercel function logs.' });
    }
  }
}
