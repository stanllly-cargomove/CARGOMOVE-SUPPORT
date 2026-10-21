import { bodyOf, noStore, requireAdmin } from '../_email.js';
import { autoMailClient, autoMailConfiguration } from './configuration.js';
import { checkOrigin, MailError } from './gmail.js';
import { validateArticle } from './knowledge.js';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function id(value: unknown) {
  if (typeof value !== 'string' || !uuid.test(value)) throw new MailError(400, 'Invalid learning suggestion or reply.');
  return value;
}
function version(value: unknown) {
  if (!Number.isSafeInteger(value) || Number(value) < 1) throw new MailError(400, 'Reload the learning suggestion before reviewing it.');
  return Number(value);
}
function check(error: any) {
  if (!error) return;
  const message = String(error.message || '');
  if (message.includes('LEARNING_CONFLICT')) throw new MailError(409, 'This suggestion was already reviewed or changed. Reload it; your unsaved text is preserved.');
  if (message.includes('KB_CONFLICT')) throw new MailError(409, 'The target KB article changed. Refresh its version and review it again. Your unsaved text is preserved.');
  if (message.includes('LEARNING_NOT_SENT')) throw new MailError(409, 'Only a confirmed sent reply can become a learning suggestion.');
  if (/LEARNING_NOT_FOUND|KB_NOT_FOUND/.test(message)) throw new MailError(404, 'The suggestion or target KB article was not found.');
  if (message.includes('LEARNING_REJECTION_NOTE_REQUIRED')) throw new MailError(400, 'Enter a reason for rejecting this suggestion.');
  if (/LEARNING_INVALID|KB_INVALID/.test(message)) throw new MailError(400, 'Check the review action, article fields and review note.');
  throw new MailError(503, 'Learning storage is unavailable. Check the Milestone 4 migration and Auto Mail connection.');
}

export function createLearningHandler(action: 'list' | 'detail' | 'propose' | 'review') {
  return async (request: any, response: any) => {
    noStore(response);
    const session = requireAdmin(request, response);
    if (!session) return;
    const method = ['list', 'detail'].includes(action) ? 'GET' : 'POST';
    if (request.method !== method) return response.status(405).json({ error: 'Method not allowed.' });
    try {
      if (method === 'POST') checkOrigin(request);
      const config = autoMailConfiguration();
      if (!config.ready) throw new MailError(503, config.message);
      const client = autoMailClient(config);
      if (action === 'list') {
        const status = typeof request.query?.status === 'string' ? request.query.status : 'PENDING';
        const offset = Number(request.query?.offset || 0);
        if (!['', 'PENDING', 'APPROVED', 'REJECTED'].includes(status) || !Number.isSafeInteger(offset) || offset < 0 || offset > 100000) throw new MailError(400, 'Invalid learning queue filter or page.');
        const result = await client.rpc('list_learning_suggestions', { p_status: status, p_offset: offset });
        check(result.error);
        return response.json(result.data);
      }
      if (action === 'detail') {
        const suggestionId = id(request.query?.id);
        const result = await client.from('learning_suggestions').select('*').eq('id', suggestionId).maybeSingle();
        check(result.error);
        if (!result.data) throw new MailError(404, 'Learning suggestion was not found.');
        const events = await client.from('learning_events').select('id,action,created_at,detail').eq('suggestion_id', suggestionId).order('created_at', { ascending: true });
        check(events.error);
        return response.json({ suggestion: result.data, events: events.data || [] });
      }
      const input = await bodyOf(request);
      if (action === 'propose') {
        const result = await client.rpc('propose_learning_from_reply', { p_delivery_id: id(input.deliveryId), p_actor: session.id });
        check(result.error);
        return response.json({ suggestion: result.data });
      }
      if (!['APPROVE', 'REJECT'].includes(String(input.action))) throw new MailError(400, 'Invalid learning review action.');
      const note = typeof input.note === 'string' ? input.note.trim() : '';
      if (note.length > 2000 || (input.action === 'REJECT' && !note)) throw new MailError(400, 'Provide a rejection reason, or a review note of up to 2,000 characters.');
      const article = input.action === 'APPROVE' ? validateArticle(input) : null;
      const targetId = input.action === 'APPROVE' && input.targetId != null ? id(input.targetId) : null;
      const result = await client.rpc('review_learning_suggestion', { p_id: id(input.id), p_expected_version: version(input.version), p_action: input.action,
        p_article: article, p_target_id: targetId, p_target_version: targetId ? version(input.targetVersion) : null, p_note: note, p_actor: session.id });
      check(result.error);
      return response.json({ suggestion: result.data });
    } catch (error) {
      return response.status(error instanceof MailError ? error.status : 503).json({ error: error instanceof MailError ? error.message : 'Unable to complete the learning request.' });
    }
  };
}

export const learningList = createLearningHandler('list');
export const learningDetail = createLearningHandler('detail');
export const learningPropose = createLearningHandler('propose');
export const learningReview = createLearningHandler('review');
