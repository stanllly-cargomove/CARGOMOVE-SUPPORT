import type { Request, Response } from 'express';
import { supportRead, supportUuid } from '../support/queries.js';
export default function analysis(request: Request, response: Response) {
  return supportRead(request, response, 'get_support_analysis', () => ({
    p_id: supportUuid(request.query.id),
  }));
}
