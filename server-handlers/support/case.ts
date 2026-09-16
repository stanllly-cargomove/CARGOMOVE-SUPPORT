import type { Request, Response } from 'express';
import type { SupportCaseDetail } from '../../src/services/support.js';
import { supportRead, supportUuid, pageOffset } from './queries.js';
export default function caseDetail(request: Request, response: Response) {
  return supportRead<SupportCaseDetail>(
    request,
    response,
    'get_support_case',
    () => ({
      p_id: supportUuid(request.query.id),
      p_offset: pageOffset(request.query.offset),
    }),
  );
}
