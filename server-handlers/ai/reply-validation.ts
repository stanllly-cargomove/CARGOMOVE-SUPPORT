import { AnalysisError } from './validation.js';
import { REPLY_TEMPLATES } from '../../src/types/supportAI.js';
import type { ReplyTemplate } from '../../src/types/supportAI.js';
import type { SupportKnowledge } from '../../src/types/knowledge.js';
import { SupportQueryError } from '../support/queries.js';
export function replyTemplate(value: unknown): ReplyTemplate {
  if (
    typeof value !== 'string' ||
    !(REPLY_TEMPLATES as readonly string[]).includes(value)
  )
    throw new SupportQueryError('Select a valid reply template.');
  return value as ReplyTemplate;
}
export function editedReply(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.trim().length > 6000 ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)
  )
    throw new SupportQueryError('Reply must contain 1–6000 characters.');
  return value.trim();
}
export function validateReply(
  value: unknown,
  template: ReplyTemplate,
  articles: SupportKnowledge[],
): { reply_text: string; knowledge_ids: string[] } {
  const invalid = () => {
    throw new AnalysisError(
      'AI_INVALID_REPLY',
      'AI returned an unsupported reply. Review the guidance and handle the case manually.',
      502,
    );
  };
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return invalid();
  const data = value as Record<string, unknown>;
  if (
    Object.keys(data).length !== 2 ||
    !Object.hasOwn(data, 'reply_text') ||
    !Object.hasOwn(data, 'knowledge_ids')
  )
    return invalid();
  let text: string;
  try {
    text = editedReply(data.reply_text);
  } catch {
    return invalid();
  }
  if (/<\/?[a-z][^>]*>|\[(?:email|secret) omitted\]/i.test(text))
    return invalid();
  if (
    !Array.isArray(data.knowledge_ids) ||
    data.knowledge_ids.length > 5 ||
    new Set(data.knowledge_ids).size !== data.knowledge_ids.length
  )
    return invalid();
  const permitted = new Set(
    articles.filter((k) => k.active && k.ai_reply_allowed).map((k) => k.id),
  );
  if (
    data.knowledge_ids.some(
      (id) => typeof id !== 'string' || !permitted.has(id),
    )
  )
    return invalid();
  if (
    template === 'KNOWLEDGE'
      ? data.knowledge_ids.length === 0
      : data.knowledge_ids.length !== 0
  )
    return invalid();
  // Reject common invented verification/action claims. Review still remains
  // necessary: syntactic checks cannot prove semantic grounding in all languages.
  if (
    /\b(?:we (?:have |already )?(?:approved|verified|resolved|updated|registered|cancelled|contacted)|(?:booking|container|vehicle|driver|port pass|early entry|yard opening|declaration|vessel|warehouse) (?:has been|is now|is confirmed) (?:approved|verified|registered|available|active|cancelled)|kami (?:telah|sudah) (?:meluluskan|mengesahkan|menyelesaikan|mengemas kini|menghubungi)|(?:telah|sudah) diluluskan)\b/i.test(
      text,
    )
  )
    return invalid();
  if (
    /(?:^|[.!?]\s+)(?:(?:your|the|this)\s+)?(?:vehicle|booking|container|driver|port pass|early entry|yard opening|vessel|warehouse)\s+(?:is|has been)\s+(?:approved|verified|registered|available|active|cancelled|ready)\b/i.test(
      text,
    )
  )
    return invalid();
  return { reply_text: text, knowledge_ids: data.knowledge_ids as string[] };
}
export const REPLY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    reply_text: { type: 'string', minLength: 1, maxLength: 6000 },
    knowledge_ids: { type: 'array', items: { type: 'string' }, maxItems: 5 },
  },
  required: ['reply_text', 'knowledge_ids'],
};
