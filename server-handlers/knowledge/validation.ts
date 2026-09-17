import {
  SUPPORT_CATEGORIES,
  SUPPORT_PORTS,
  SUPPORT_SUBCATEGORIES,
} from '../../src/types/support.js';
import { CATEGORY_SUBCATEGORIES } from '../ai/validation.js';
import { pageOffset, scalar, SupportQueryError } from '../support/queries.js';
import type { KnowledgeArticleInput } from '../../src/types/knowledge.js';
import type { Request } from 'express';
import { KNOWLEDGE_HIGH_RISK_SUBCATEGORIES as HIGH_RISK_SUBCATEGORIES } from '../../src/types/knowledge.js';
function fail(message: string): never {
  throw new SupportQueryError(message);
}
function member(
  value: unknown,
  values: readonly string[],
  name: string,
): string {
  if (typeof value !== 'string' || !values.includes(value))
    fail(`Invalid ${name}.`);
  return value as string;
}
function text(
  value: unknown,
  name: string,
  max: number,
  optional = false,
): string | null {
  if (optional && (value === null || value === '')) return null;
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.trim().length > max ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)
  )
    fail(`${name} must contain ${optional ? 'up to' : '1–'}${max} characters.`);
  return (value as string).trim();
}
export function knowledgeArticle(value: unknown): KnowledgeArticleInput {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    fail('An article is required.');
  const data = value as Record<string, unknown>;
  const category = member(
    data.category,
    SUPPORT_CATEGORIES,
    'category',
  ) as KnowledgeArticleInput['category'];
  const subcategory =
    data.subcategory === null
      ? null
      : (member(
          data.subcategory,
          CATEGORY_SUBCATEGORIES[category],
          'subcategory',
        ) as KnowledgeArticleInput['subcategory']);
  const booleans = [
    'requires_port_verification',
    'human_review_required',
    'ai_reply_allowed',
    'active',
  ] as const;
  for (const key of booleans)
    if (typeof data[key] !== 'boolean') fail(`Invalid ${key}.`);
  if (
    (data.requires_port_verification ||
      (subcategory && HIGH_RISK_SUBCATEGORIES.includes(subcategory))) &&
    !data.human_review_required
  )
    fail(
      'Port verification and high-risk operational issues require human review.',
    );
  if (!Array.isArray(data.keywords) || data.keywords.length > 30)
    fail('Use at most 30 keywords.');
  const keywords = [
    ...new Set(
      (data.keywords as unknown[]).map((k) => text(k, 'Keyword', 80) as string),
    ),
  ];
  const code = text(data.knowledge_code, 'Knowledge code', 80) as string;
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(code))
    fail('Knowledge code must use letters, digits, underscores or hyphens.');
  return {
    knowledge_code: code,
    title: text(data.title, 'Title', 200) as string,
    category,
    subcategory,
    port: member(
      data.port,
      [...SUPPORT_PORTS, 'ALL'],
      'port',
    ) as KnowledgeArticleInput['port'],
    problem: text(data.problem, 'Problem', 8000) as string,
    possible_cause: text(data.possible_cause, 'Possible cause', 8000, true),
    resolution: text(data.resolution, 'Resolution', 8000) as string,
    suggested_action: text(
      data.suggested_action,
      'Suggested action',
      2000,
      true,
    ),
    keywords,
    ...Object.fromEntries(booleans.map((k) => [k, data[k]])),
  } as KnowledgeArticleInput;
}
export function knowledgeFilters(
  query: Request['query'],
): Record<string, string | number> {
  const filters: Record<string, string | number> = {
    offset: pageOffset(query.offset),
  };
  for (const [key, values] of [
    ['category', SUPPORT_CATEGORIES],
    ['subcategory', SUPPORT_SUBCATEGORIES],
    ['port', [...SUPPORT_PORTS, 'ALL']],
    ['active', ['true', 'false']],
    ['ai_reply_allowed', ['true', 'false']],
    ['human_review_required', ['true', 'false']],
  ] as const) {
    const value = scalar(query[key], key);
    if (value) filters[key] = member(value, values, key);
  }
  const q = scalar(query.q, 'search');
  if (q.length > 200) fail('Search must contain at most 200 characters.');
  if (q) filters.q = q;
  return filters;
}
export function expectedVersion(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?(?:Z|[+-]\d\d:\d\d)$/.test(
      value,
    ) ||
    !Number.isFinite(Date.parse(value))
  )
    fail('A valid article version is required. Reload the article.');
  return value as string;
}
