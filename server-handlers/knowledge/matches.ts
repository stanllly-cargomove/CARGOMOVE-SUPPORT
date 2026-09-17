import type { Request, Response } from 'express';
import { supportRead, supportUuid } from '../support/queries.js';
export default function matches(request: Request, response: Response) {
  return supportRead(request, response, 'match_support_knowledge', () => ({
    p_id: supportUuid(request.query.id),
  }));
}
