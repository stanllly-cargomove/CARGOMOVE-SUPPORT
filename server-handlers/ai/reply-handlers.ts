import { randomUUID } from 'node:crypto';
import type { Request, Response } from 'express';
import { configuredClient, noStore, requireAdmin, bodyOf } from '../_email.js';
import {
  supportUuid,
  SupportQueryError,
  supportRead,
} from '../support/queries.js';
import { expectedVersion } from '../knowledge/validation.js';
import { AnalysisError } from './validation.js';
import { classificationConfig } from './provider.js';
import { analysisContext } from './context.js';
import { generateReply } from './reply-provider.js';
import {
  editedReply,
  replyTemplate,
  validateReply,
} from './reply-validation.js';
import { REPLY_PROMPT_VERSION } from './prompts/reply.js';
import type { AIInteraction, StoredReply } from '../../src/types/supportAI.js';
import type { SupportKnowledge } from '../../src/types/knowledge.js';
import type { SupportMessage } from '../../src/types/support.js';
const errors: Record<string, [number, string]> = {
  PENDING: [409, 'A Gmail action is pending. Check its result before editing.'],
  ALREADY_SENT: [409, 'This reply has already been sent.'],
  NOT_FOUND: [404, 'Case or reply draft not found.'],
  RESOLVED: [409, 'Resolved cases cannot generate replies.'],
  NO_ANALYSIS: [409, 'Analyze the case before generating a reply.'],
  STALE: [409, 'The case or analysis changed. Reload and analyze again.'],
  BUSY: [409, 'A reply is already being generated. Retry shortly.'],
  NO_KNOWLEDGE: [
    409,
    'No matching active knowledge allows AI replies. Use an acknowledgement or information request, or review the Knowledge Base.',
  ],
  STALE_KNOWLEDGE: [
    409,
    'Knowledge changed during generation. Refresh and try again.',
  ],
  INVALID_SOURCES: [502, 'AI returned unsupported knowledge references.'],
  CONFLICT: [409, 'Another admin edited this draft. Reload it before saving.'],
};
function failure(code: string): never {
  const [status, message] = errors[code] || [
    503,
    'Unable to prepare the reply.',
  ];
  throw new AnalysisError(code, message, status);
}
function respond(error: unknown, response: Response) {
  return response
    .status(
      error instanceof AnalysisError
        ? error.status
        : error instanceof SupportQueryError
          ? 400
          : 503,
    )
    .json({
      error:
        error instanceof AnalysisError || error instanceof SupportQueryError
          ? error.message
          : 'Unable to access the reply draft. Retry later.',
      code: error instanceof AnalysisError ? error.code : 'REPLY_FAILED',
    });
}
export async function replyRead(request: Request, response: Response) {
  return supportRead(request, response, 'get_support_reply', () => ({
    p_case: supportUuid(request.query.id),
    p_draft:
      request.query.draft_id === undefined
        ? null
        : supportUuid(request.query.draft_id),
  }));
}
export async function replyGenerate(request: Request, response: Response) {
  noStore(response);
  if (request.method !== 'POST')
    return response.status(405).json({ error: 'Method not allowed.' });
  const admin = requireAdmin(request, response);
  if (!admin) return;
  const client = configuredClient(response);
  if (!client) return;
  let id = '',
    claimed = false;
  const token = randomUUID();
  try {
    const body = await bodyOf(request);
    id = supportUuid(body.case_id);
    const template = replyTemplate(body.template_id);
    const config =
      template === 'KNOWLEDGE'
        ? classificationConfig()
        : { model: 'support-static-v1', apiKey: '' };
    const claim = await client.rpc<{
      error?: string;
      cached_id?: string;
      analysis: AIInteraction;
      snapshot: { subject: string; messages: SupportMessage[] };
      articles: SupportKnowledge[];
    }>('claim_support_reply', {
      p_id: id,
      p_template: template,
      p_model: config.model,
      p_version: REPLY_PROMPT_VERSION,
      p_token: token,
      p_admin: admin.id,
    });
    if (claim.error || !claim.data)
      throw new AnalysisError(
        'DATABASE_UNAVAILABLE',
        'Unable to prepare replies. Check the reply migration and retry.',
        503,
      );
    if (claim.data.error) failure(claim.data.error);
    let draftId = claim.data.cached_id;
    if (!draftId) {
      claimed = true;
      const { analysis, snapshot, articles } = claim.data;
      let result: { reply_text: string; knowledge_ids: string[] };
      if (template === 'KNOWLEDGE')
        result = await generateReply(
          analysisContext(snapshot.subject, snapshot.messages),
          analysis,
          template,
          articles,
          config,
        );
      else {
        const ms =
          analysis.language === 'MS' || analysis.language === 'MIXED_MS_EN';
        const text =
          template === 'ACKNOWLEDGE'
            ? ms
              ? 'Terima kasih kerana menghubungi CargoMove. Kami telah menerima pertanyaan anda. Maklumat lanjut memerlukan semakan oleh pasukan sokongan.'
              : 'Thank you for contacting CargoMove. We have received your enquiry. Further guidance requires review by our support team.'
            : ms
              ? 'Terima kasih kerana menghubungi CargoMove. Sila berikan penerangan ringkas tentang isu ini dan nombor rujukan tempahan atau kontena yang berkaitan, jika ada. Jangan kongsi kata laluan atau token akses.'
              : 'Thank you for contacting CargoMove. Please provide a brief description of the issue and any relevant booking or container reference. Do not share passwords or access tokens.';
        result = validateReply(
          { reply_text: text, knowledge_ids: [] },
          template,
          [],
        );
      }
      const saved = await client.rpc<{ error?: string; draft_id: string }>(
        'complete_support_reply',
        {
          p_id: id,
          p_token: token,
          p_text: result.reply_text,
          p_knowledge_ids: result.knowledge_ids,
        },
      );
      if (saved.error || !saved.data)
        throw new AnalysisError(
          'DATABASE_UNAVAILABLE',
          'Unable to save the generated reply. Retry later.',
          503,
        );
      if (saved.data.error) failure(saved.data.error);
      draftId = saved.data.draft_id;
      claimed = false;
    }
    const stored = await client.rpc<StoredReply>('get_support_reply', {
      p_case: id,
      p_draft: draftId,
    });
    if (stored.error || !stored.data?.draft)
      throw new AnalysisError(
        'DATABASE_UNAVAILABLE',
        'Reply was prepared, but could not be loaded. Refresh the saved draft.',
        503,
      );
    return response.json({ ...stored.data, cached: !!claim.data.cached_id });
  } catch (error) {
    if (claimed)
      await client
        .rpc('release_support_reply', { p_id: id, p_token: token })
        .catch(() => undefined);
    return respond(error, response);
  }
}
export async function replyEdit(request: Request, response: Response) {
  noStore(response);
  if (request.method !== 'PUT')
    return response.status(405).json({ error: 'Method not allowed.' });
  const admin = requireAdmin(request, response);
  if (!admin) return;
  const client = configuredClient(response);
  if (!client) return;
  try {
    const body = await bodyOf(request);
    const result = await client.rpc<StoredReply & { error?: string }>(
      'edit_support_reply',
      {
        p_id: supportUuid(body.id),
        p_expected: expectedVersion(body.updated_at),
        p_text: editedReply(body.reply_text),
        p_admin: admin.id,
      },
    );
    if (result.error || !result.data)
      throw new AnalysisError(
        'DATABASE_UNAVAILABLE',
        'Unable to save draft edits. Retry later.',
        503,
      );
    if (result.data.error) failure(result.data.error);
    return response.json(result.data);
  } catch (error) {
    return respond(error, response);
  }
}
