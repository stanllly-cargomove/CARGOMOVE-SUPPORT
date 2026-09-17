import type { Request, Response } from 'express';
import { configuredClient, noStore, requireAdmin, bodyOf } from '../_email.js';
import {
  supportRead,
  supportUuid,
  SupportQueryError,
} from '../support/queries.js';
import {
  knowledgeArticle,
  knowledgeFilters,
  expectedVersion,
} from './validation.js';
export default async function articles(request: Request, response: Response) {
  if (request.method === 'GET')
    return supportRead(request, response, 'list_support_knowledge', () => ({
      p_filters: knowledgeFilters(request.query),
    }));
  noStore(response);
  if (request.method !== 'POST' && request.method !== 'PUT')
    return response.status(405).json({ error: 'Method not allowed.' });
  const admin = requireAdmin(request, response);
  if (!admin) return;
  const client = configuredClient(response);
  if (!client) return;
  try {
    const body = await bodyOf(request);
    const { data, error } = await client.rpc<{ error?: string }>(
      'save_support_knowledge',
      {
        p_id: request.method === 'PUT' ? supportUuid(body.id) : null,
        p_expected:
          request.method === 'PUT' ? expectedVersion(body.updated_at) : null,
        p_article: knowledgeArticle(body.article),
        p_admin: admin.id,
      },
    );
    if (error || !data)
      return response
        .status(503)
        .json({
          error:
            'Unable to save knowledge. Check the knowledge migration and retry.',
        });
    if (data.error) {
      const messages: Record<string, string> = {
        CONFLICT:
          'Another admin changed this article. Reload it before saving.',
        DUPLICATE_CODE: 'This knowledge code is already in use.',
        NOT_FOUND: 'Knowledge article not found.',
      };
      return response
        .status(data.error === 'NOT_FOUND' ? 404 : 409)
        .json({ error: messages[data.error] || 'Unable to save knowledge.' });
    }
    return response.status(request.method === 'POST' ? 201 : 200).json(data);
  } catch (error) {
    return response
      .status(error instanceof SupportQueryError ? 400 : 503)
      .json({
        error:
          error instanceof SupportQueryError
            ? error.message
            : 'Unable to save knowledge. Retry later.',
      });
  }
}
