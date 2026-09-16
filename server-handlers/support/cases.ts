import type { Request, Response } from 'express';
import type { SupportCasePage } from '../../src/types/support.js';
import { supportRead, supportFilters } from './queries.js';
export default function cases(request: Request, response: Response) {
  return supportRead<SupportCasePage>(
    request,
    response,
    'list_support_cases',
    () => ({ p_filters: supportFilters(request.query) }),
  );
}
