import { randomUUID } from 'node:crypto';
import type { Request, Response } from 'express';
import { bodyOf, configuredClient, noStore, requireAdmin } from '../_email.js';
import { supportUuid, SupportQueryError } from '../support/queries.js';
import { AnalysisError } from './validation.js';
import { analysisContext } from './context.js';
import { classificationConfig, classifyContext } from './provider.js';
import { CLASSIFY_PROMPT_VERSION } from './prompts/classify.js';
import type { SupportMessage } from '../../src/types/support.js';
import type { AIInteraction } from '../../src/types/supportAI.js';
const errors: Record<string, [number, string]> = {
  NOT_FOUND: [404, 'Support case not found.'],
  RESOLVED: [409, 'Reopen the case before analyzing it.'],
  NO_MESSAGE: [409, 'No customer message is available.'],
  BUSY: [409, 'This case is already being analyzed. Retry shortly.'],
  STALE: [409, 'The case changed during analysis. Reload it and try again.'],
};
export default async function analyze(request: Request, response: Response) {
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
    const config = classificationConfig();
    const claim = await client.rpc<{
      error?: string;
      cached?: AIInteraction;
      subject: string;
      messages: SupportMessage[];
    }>('claim_support_analysis', {
      p_id: id,
      p_model: config.model,
      p_version: CLASSIFY_PROMPT_VERSION,
      p_token: token,
      p_admin: admin.id,
    });
    if (claim.error || !claim.data)
      throw new AnalysisError(
        'DATABASE_UNAVAILABLE',
        'Unable to prepare analysis. Check the classification migration and retry.',
        503,
      );
    if (claim.data.error) {
      const [status, message] = errors[claim.data.error] || [
        503,
        'Unable to prepare analysis.',
      ];
      throw new AnalysisError(claim.data.error, message, status);
    }
    if (claim.data.cached)
      return response.json({ interaction: claim.data.cached, cached: true });
    claimed = true;
    const result = await classifyContext(
      analysisContext(claim.data.subject, claim.data.messages),
      config,
    );
    const saved = await client.rpc<AIInteraction & { error?: string }>(
      'complete_support_analysis',
      { p_id: id, p_token: token, p_result: result },
    );
    if (saved.error || !saved.data)
      throw new AnalysisError(
        'DATABASE_UNAVAILABLE',
        'Unable to save analysis. Retry later.',
        503,
      );
    if (saved.data.error) {
      const [status, message] = errors[saved.data.error] || [
        503,
        'Unable to save analysis.',
      ];
      throw new AnalysisError(saved.data.error, message, status);
    }
    claimed = false;
    return response.json({ interaction: saved.data, cached: false });
  } catch (error) {
    if (claimed)
      await client
        .rpc('release_support_analysis', { p_id: id, p_token: token })
        .catch(() => undefined);
    const status =
      error instanceof AnalysisError
        ? error.status
        : error instanceof SupportQueryError
          ? 400
          : 503;
    return response
      .status(status)
      .json({
        error:
          error instanceof AnalysisError || error instanceof SupportQueryError
            ? error.message
            : 'Unable to analyze this case. Continue handling it manually.',
        code: error instanceof AnalysisError ? error.code : 'ANALYSIS_FAILED',
      });
  }
}
