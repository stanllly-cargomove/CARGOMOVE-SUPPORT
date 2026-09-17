import { GoogleGenAI } from '@google/genai';
import { classificationConfig } from './provider.js';
import { AnalysisError } from './validation.js';
import { REPLY_INSTRUCTIONS } from './prompts/reply.js';
import { REPLY_SCHEMA, validateReply } from './reply-validation.js';
import type {
  ReplyTemplate,
  AIInteraction,
} from '../../src/types/supportAI.js';
import type { SupportKnowledge } from '../../src/types/knowledge.js';
import type { AnalysisContext } from './context.js';
export async function generateReply(
  context: AnalysisContext,
  analysis: AIInteraction,
  template: ReplyTemplate,
  articles: SupportKnowledge[],
  config: ReturnType<typeof classificationConfig>,
) {
  let text: string | undefined;
  try {
    const ai = new GoogleGenAI({
      apiKey: config.apiKey,
      httpOptions: { timeout: 25000, retryOptions: { attempts: 1 } },
    });
    const response = await ai.models.generateContent({
      model: config.model,
      contents: JSON.stringify({
        context,
        template,
        classification: {
          category: analysis.category,
          subcategory: analysis.subcategory,
          port: analysis.port,
          language: analysis.language,
          urgency: analysis.urgency,
        },
        knowledge: articles.map((k) => ({
          id: k.id,
          title: k.title,
          problem: k.problem,
          possible_cause: k.possible_cause,
          resolution: k.resolution,
          suggested_action: k.suggested_action,
          requires_port_verification: k.requires_port_verification,
          human_review_required: k.human_review_required,
        })),
      }),
      config: {
        systemInstruction: REPLY_INSTRUCTIONS,
        responseMimeType: 'application/json',
        responseJsonSchema: REPLY_SCHEMA,
        maxOutputTokens: 2048,
        thinkingConfig: { includeThoughts: false },
        abortSignal: AbortSignal.timeout(25000),
      },
    });
    text = response.text;
  } catch {
    throw new AnalysisError(
      'AI_UNAVAILABLE',
      'AI is temporarily unavailable. Your conversation and saved draft remain available.',
      503,
    );
  }
  if (!text || text.length > 20000)
    throw new AnalysisError(
      'AI_INVALID_REPLY',
      'AI returned no supported reply.',
      502,
    );
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new AnalysisError(
      'AI_INVALID_REPLY',
      'AI returned invalid reply JSON.',
      502,
    );
  }
  return validateReply(parsed, template, articles);
}
