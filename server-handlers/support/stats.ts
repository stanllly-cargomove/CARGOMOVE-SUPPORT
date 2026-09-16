import type { Request, Response } from 'express';
import type { SupportStats } from '../../src/types/support.js';
import { supportRead } from './queries.js';
export default function stats(request: Request, response: Response) {
  return supportRead<SupportStats>(
    request,
    response,
    'support_inbox_stats',
    () => ({}),
  );
}
