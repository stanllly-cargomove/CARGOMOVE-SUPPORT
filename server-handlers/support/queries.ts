import {
  SUPPORT_CATEGORIES,
  SUPPORT_PORTS,
  SUPPORT_STATUSES,
} from '../../src/types/support.js';
import type { Request, Response } from 'express';
import { configuredClient, noStore, requireAdmin } from '../_email.js';

export class SupportQueryError extends Error {}
export function scalar(value: unknown, name: string): string {
  if (value === undefined) return '';
  if (typeof value !== 'string')
    throw new SupportQueryError(`Invalid ${name}.`);
  return value.trim();
}
export function supportUuid(value: unknown): string {
  const id = scalar(value, 'case identifier');
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
  )
    throw new SupportQueryError('A valid case identifier is required.');
  return id;
}
export function pageOffset(value: unknown): number {
  const text = scalar(value, 'page offset');
  if (text && (!/^\d+$/.test(text) || Number(text) > 100000))
    throw new SupportQueryError('Invalid page offset.');
  return Number(text || 0);
}
export function supportFilters(
  query: Request['query'],
): Record<string, string | number> {
  const result: Record<string, string | number> = {
    offset: pageOffset(query.offset),
  };
  for (const [name, values] of [
    ['status', SUPPORT_STATUSES],
    ['category', SUPPORT_CATEGORIES],
    ['port', SUPPORT_PORTS],
    ['confidence', ['HIGH', 'MEDIUM', 'LOW', 'NONE']],
  ] as const) {
    const value = scalar(query[name], name);
    if (value && !(values as readonly string[]).includes(value))
      throw new SupportQueryError(`Invalid ${name}.`);
    if (value) result[name] = value;
  }
  const search = scalar(query.q, 'search');
  if (search.length > 200)
    throw new SupportQueryError('Search must contain at most 200 characters.');
  if (search) result.q = search;
  const assigned = scalar(query.assigned_to, 'assignment');
  if (assigned)
    result.assigned_to =
      assigned === 'UNASSIGNED' ? assigned : supportUuid(assigned);
  for (const name of ['from', 'to'] as const) {
    const date = scalar(query[name], name);
    if (date) {
      if (
        !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
        !Number.isFinite(Date.parse(date)) ||
        new Date(date).toISOString().slice(0, 10) !== date
      )
        throw new SupportQueryError(`Invalid ${name} date.`);
      result[name] =
        name === 'to'
          ? new Date(Date.parse(date) + 86400000).toISOString()
          : new Date(date).toISOString();
    }
  }
  if (
    result.from &&
    result.to &&
    Date.parse(String(result.from)) >= Date.parse(String(result.to))
  )
    throw new SupportQueryError(
      'The end date must not precede the start date.',
    );
  return result;
}
export async function supportRead<T>(
  request: Request,
  response: Response,
  name: string,
  args: () => Record<string, unknown>,
) {
  noStore(response);
  if (request.method !== 'GET')
    return response.status(405).json({ error: 'Method not allowed.' });
  if (!requireAdmin(request, response)) return;
  const client = configuredClient(response);
  if (!client) return;
  try {
    const { data, error } = await client.rpc<T>(name, args());
    if (error)
      return response.status(503).json({
        error:
          'Unable to load support data. Check that support migrations have been applied.',
      });
    if (data === null)
      return response.status(404).json({ error: 'Support case not found.' });
    return response.json(data);
  } catch (error) {
    return response
      .status(error instanceof SupportQueryError ? 400 : 503)
      .json({
        error:
          error instanceof SupportQueryError
            ? error.message
            : 'Unable to load support data. Retry later.',
      });
  }
}
