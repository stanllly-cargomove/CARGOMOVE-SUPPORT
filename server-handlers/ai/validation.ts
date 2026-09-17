import {
  SUPPORT_CATEGORIES,
  SUPPORT_PORTS,
  SUPPORT_URGENCIES,
} from '../../src/types/support.js';
import { SUPPORT_ACTIONS } from '../../src/types/supportAI.js';
import type {
  SupportEntities,
  ValidatedClassification,
} from '../../src/types/supportAI.js';

export class AnalysisError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 502,
  ) {
    super(message);
  }
}
export { KNOWLEDGE_SUBCATEGORIES as CATEGORY_SUBCATEGORIES } from '../../src/types/knowledge.js';
import { KNOWLEDGE_SUBCATEGORIES as CATEGORY_SUBCATEGORIES } from '../../src/types/knowledge.js';
export const ENTITY_KEYS = [
  'company_name',
  'vehicle_number',
  'driver_name',
  'driver_identifier',
  'container_number',
  'booking_number',
  'vessel',
  'port',
  'warehouse',
  'error_message',
] as const;
const KEYS = [
  'category',
  'subcategory',
  'port',
  'language',
  'urgency',
  'confidence',
  'entities',
  'recommended_action',
  'requires_human_review',
  'short_explanation',
];
function invalid(): never {
  throw new AnalysisError(
    'AI_INVALID_RESPONSE',
    'AI returned an invalid classification. The case remains available for manual handling.',
  );
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return invalid();
  return value as Record<string, unknown>;
}
function exact(value: Record<string, unknown>, keys: readonly string[]) {
  if (
    Object.keys(value).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(value, key))
  )
    invalid();
}
function member<T extends string>(value: unknown, values: readonly T[]): T {
  if (typeof value !== 'string' || !values.includes(value as T))
    return invalid();
  return value as T;
}
export function validateClassification(
  value: unknown,
  evidence: string,
): ValidatedClassification {
  const data = object(value);
  exact(data, KEYS);
  const category = member(data.category, SUPPORT_CATEGORIES);
  const subcategory =
    data.subcategory === null
      ? null
      : member(data.subcategory, CATEGORY_SUBCATEGORIES[category]);
  const port = member(data.port, SUPPORT_PORTS),
    language = member(data.language, [
      'EN',
      'MS',
      'MIXED_MS_EN',
      'UNKNOWN',
    ] as const),
    urgency = member(data.urgency, SUPPORT_URGENCIES);
  if (
    typeof data.confidence !== 'number' ||
    !Number.isFinite(data.confidence) ||
    data.confidence < 0 ||
    data.confidence > 1 ||
    typeof data.requires_human_review !== 'boolean'
  )
    invalid();
  if (
    typeof data.short_explanation !== 'string' ||
    !data.short_explanation.trim() ||
    data.short_explanation.length > 500 ||
    /[\u0000-\u0008]/.test(data.short_explanation)
  )
    invalid();
  if (
    port !== 'UNKNOWN' &&
    !evidence.toLowerCase().replace(/[\s-]/g, '').includes(port.toLowerCase())
  )
    invalid();
  const source = object(data.entities);
  exact(source, ENTITY_KEYS);
  const entities = {} as SupportEntities;
  for (const key of ENTITY_KEYS) {
    const entity = source[key];
    if (entity === null) {
      entities[key] = null;
      continue;
    }
    if (
      typeof entity !== 'string' ||
      !entity.trim() ||
      entity.length > 200 ||
      /[\u0000-\u001f]/.test(entity)
    )
      invalid();
    // Extracted entities must occur in supplied customer text, not a guessed
    // identifier. Normalization permits harmless whitespace/case differences.
    const normalized = (text: string) =>
      text.toLowerCase().replace(/\s+/g, ' ').trim();
    if (
      entity.includes('[email omitted]') ||
      entity.includes('[secret omitted]') ||
      !normalized(evidence).includes(normalized(entity))
    )
      invalid();
    if (key === 'port') entities.port = member(entity, SUPPORT_PORTS);
    else entities[key] = entity.trim();
  }
  // Driver identifiers are unnecessary for other issue categories.
  if (category !== 'DRIVER') entities.driver_identifier = null;
  return {
    category,
    subcategory,
    port,
    language,
    urgency,
    confidence: data.confidence as number,
    entities,
    recommended_action: member(data.recommended_action, SUPPORT_ACTIONS),
    short_explanation: data.short_explanation.trim(),
    // No trusted operational tools or knowledge retrieval exist yet. Confidence
    // and model assertions cannot authorize an operational answer.
    requires_human_review: true,
  };
}
export const CLASSIFICATION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    category: { type: 'string', enum: SUPPORT_CATEGORIES },
    subcategory: {
      anyOf: [
        {
          type: 'string',
          enum: [...new Set(Object.values(CATEGORY_SUBCATEGORIES).flat())],
        },
        { type: 'null' },
      ],
    },
    port: { type: 'string', enum: SUPPORT_PORTS },
    language: { type: 'string', enum: ['EN', 'MS', 'MIXED_MS_EN', 'UNKNOWN'] },
    urgency: { type: 'string', enum: SUPPORT_URGENCIES },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    recommended_action: { type: 'string', enum: SUPPORT_ACTIONS },
    requires_human_review: { type: 'boolean' },
    short_explanation: { type: 'string', maxLength: 500 },
    entities: {
      type: 'object',
      additionalProperties: false,
      properties: Object.fromEntries(
        ENTITY_KEYS.map((key) => [
          key,
          key === 'port'
            ? {
                anyOf: [
                  { type: 'string', enum: SUPPORT_PORTS },
                  { type: 'null' },
                ],
              }
            : { type: ['string', 'null'], maxLength: 200 },
        ]),
      ),
      required: ENTITY_KEYS,
    },
  },
  required: KEYS,
};
