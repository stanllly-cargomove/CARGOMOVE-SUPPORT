import { bodyOf, noStore, requireAdmin } from '../_email.js';
import { autoMailClient, autoMailConfiguration } from './configuration.js';
import { checkOrigin, MailError } from './gmail.js';

const columns = 'id,title,content,summary,category,port,keywords,status,version,created_at,updated_at,approved_at';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function validateArticle(input: Record<string, unknown>) {
  const title = typeof input.title === 'string' ? input.title.trim() : '';
  const content = typeof input.content === 'string' ? input.content.trim() : '';
  const summary = typeof input.summary === 'string' ? input.summary.trim() : '';
  const category = typeof input.category === 'string' ? input.category.trim() : 'General';
  const port = typeof input.port === 'string' ? input.port.trim().toUpperCase() : 'ALL';
  if (!Array.isArray(input.keywords) || input.keywords.some(tag => typeof tag !== 'string')) throw new MailError(400, 'Keywords must be a list of words or phrases.');
  const keywords = [...new Set((input.keywords as string[]).map(tag => tag.trim()).filter(Boolean))];
  if (!title || title.length > 160 || !content || content.length > 30000 || summary.length > 400 || !category || category.length > 80 || !port || port.length > 80 || keywords.length > 20 || keywords.some(tag => tag.length > 60)) {
    throw new MailError(400, 'Enter a title (up to 160 characters), answer (30,000), summary (400), category and port (80 each), and up to 20 keywords (60 each).');
  }
  return { title, content, summary, category, port, keywords };
}

function checkResult(error: any) {
  if (!error) return;
  const message = String(error.message || '');
  if (message.includes('KB_CONFLICT')) throw new MailError(409, 'Another administrator changed this article. Reload it before saving or reviewing. Your unsaved text is preserved.');
  if (message.includes('KB_NOT_FOUND')) throw new MailError(404, 'Knowledge article was not found.');
  if (message.includes('KB_INVALID')) throw new MailError(400, 'This article or status change is invalid. Reload the article and check its fields.');
  throw new MailError(503, 'Unable to access the knowledge base. Check the Milestone 3 migration and database connection.');
}

function articleId(value: unknown) {
  if (typeof value !== 'string' || !uuid.test(value)) throw new MailError(400, 'Invalid knowledge article.');
  return value;
}
function version(value: unknown) {
  if (!Number.isSafeInteger(value) || Number(value) < 1) throw new MailError(400, 'Reload the knowledge article before changing it.');
  return Number(value);
}

export function createKnowledgeHandler(action: 'list' | 'detail' | 'save' | 'review' | 'matches') {
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
        const query = typeof request.query?.q === 'string' ? request.query.q.trim() : '';
        const status = typeof request.query?.status === 'string' ? request.query.status : '';
        const offset = Number(request.query?.offset || 0);
        if (query.length > 200 || !['', 'DRAFT', 'APPROVED', 'ARCHIVED'].includes(status) || !Number.isSafeInteger(offset) || offset < 0 || offset > 100000) throw new MailError(400, 'Invalid knowledge search or page.');
        const result = await client.rpc('list_knowledge_articles', { p_query: query, p_status: status, p_offset: offset });
        checkResult(result.error);
        return response.json(result.data);
      }
      if (action === 'detail') {
        const id = articleId(request.query?.id);
        const result = await client.from('knowledge_articles').select(columns).eq('id', id).maybeSingle();
        checkResult(result.error);
        if (!result.data) throw new MailError(404, 'Knowledge article was not found.');
        const history = await client.from('knowledge_revisions').select('id,version,action,created_at,snapshot').eq('article_id', id).order('version', { ascending: false }).limit(20);
        checkResult(history.error);
        return response.json({ article: result.data, revisions: history.data || [] });
      }
      const input = await bodyOf(request).catch(() => { throw new MailError(400, 'Invalid request.'); });
      if (action === 'matches') {
        const query = typeof input.query === 'string' ? input.query.trim() : '';
        if (!query || query.length > 4000) throw new MailError(400, 'Enter a search of up to 4,000 characters.');
        const result = await client.rpc('match_knowledge_articles', { p_query: query });
        checkResult(result.error);
        return response.json({ articles: result.data || [], retrieval: 'KEYWORD', aiGenerated: false });
      }
      if (action === 'save') {
        const article = validateArticle(input);
        const id = input.id == null ? null : articleId(input.id);
        const result = await client.rpc('save_knowledge_article', { p_id: id, p_expected_version: id ? version(input.version) : null, p_article: article, p_actor: session.id });
        checkResult(result.error);
        return response.json({ article: result.data });
      }
      if (!['APPROVE', 'ARCHIVE', 'DRAFT'].includes(String(input.action))) throw new MailError(400, 'Invalid article status change.');
      const result = await client.rpc('review_knowledge_article', { p_id: articleId(input.id), p_expected_version: version(input.version), p_action: input.action, p_actor: session.id });
      checkResult(result.error);
      return response.json({ article: result.data });
    } catch (error) {
      return response.status(error instanceof MailError ? error.status : 503).json({ error: error instanceof MailError ? error.message : 'Unable to complete the knowledge base request.' });
    }
  };
}

export const knowledgeList = createKnowledgeHandler('list');
export const knowledgeDetail = createKnowledgeHandler('detail');
export const knowledgeSave = createKnowledgeHandler('save');
export const knowledgeReview = createKnowledgeHandler('review');
export const knowledgeMatches = createKnowledgeHandler('matches');
