import type { SupportMessage } from '../../src/types/support.js';
import { AnalysisError } from './validation.js';

export interface AnalysisContext {
  subject: string;
  conversation: Array<{ direction: string; text: string }>;
}
export function redactText(text: string): string {
  return text
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[email omitted]')
    .replace(
      /\b(password|kata laluan|refresh[_ -]?token|access[_ -]?token|api[_ -]?key)\s*[:=]\s*[^\r\n]+/gi,
      '$1: [secret omitted]',
    )
    .replace(/\bBearer\s+\S+/gi, 'Bearer [secret omitted]')
    .split(
      /\n\s*(?:--\s*$|On .{0,200} wrote:|Pada .{0,200} menulis:|[- ]*Original Message[- ]*)/im,
    )[0]
    .replace(/\0/g, '')
    .trim();
}
export function analysisContext(
  subject: string,
  messages: SupportMessage[],
): AnalysisContext {
  const conversation = messages
    .slice(-6)
    .map((m) => ({
      direction: m.direction,
      text: redactText(m.body_text).slice(0, 3000),
    }));
  if (!conversation.some((m) => m.direction === 'INBOUND' && m.text))
    throw new AnalysisError(
      'NO_ANALYZABLE_CONTENT',
      'No supported customer text is available for analysis.',
      409,
    );
  return { subject: redactText(subject).slice(0, 300), conversation };
}
export function contextEvidence(context: AnalysisContext): string {
  return [
    context.subject,
    ...context.conversation
      .filter((m) => m.direction === 'INBOUND')
      .map((m) => m.text),
  ].join('\n');
}
