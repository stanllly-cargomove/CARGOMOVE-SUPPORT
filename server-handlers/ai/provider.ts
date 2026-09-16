import { GoogleGenAI } from '@google/genai';
import {
  AnalysisError,
  CLASSIFICATION_SCHEMA,
  validateClassification,
} from './validation.js';
import { contextEvidence } from './context.js';
import type { AnalysisContext } from './context.js';
import { CLASSIFY_INSTRUCTIONS } from './prompts/classify.js';
export function classificationConfig(): { apiKey: string; model: string } {
  const apiKey = process.env.GEMINI_API_KEY,
    model = process.env.GEMINI_SUPPORT_MODEL;
  if (
    !apiKey ||
    apiKey === 'MY_GEMINI_API_KEY' ||
    !model ||
    !/^[a-zA-Z0-9._-]{1,100}$/.test(model)
  )
    throw new AnalysisError(
      'AI_NOT_CONFIGURED',
      'AI classification is not configured. Staff can continue reading and handling the case manually.',
      503,
    );
  return { apiKey, model };
}
export async function classifyContext(
  context: AnalysisContext,
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
      contents: JSON.stringify(context),
      config: {
        systemInstruction: CLASSIFY_INSTRUCTIONS,
        responseMimeType: 'application/json',
        responseJsonSchema: CLASSIFICATION_SCHEMA,
        maxOutputTokens: 2048,
        thinkingConfig: { includeThoughts: false },
        abortSignal: AbortSignal.timeout(25000),
      },
    });
    text = response.text;
  } catch {
    throw new AnalysisError(
      'AI_UNAVAILABLE',
      'AI is temporarily unavailable. You can continue handling the case manually.',
      503,
    );
  }
  if (!text || text.length > 20000)
    throw new AnalysisError(
      'AI_INVALID_RESPONSE',
      'AI returned no supported classification. Retry or handle the case manually.',
    );
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new AnalysisError(
      'AI_INVALID_RESPONSE',
      'AI returned invalid JSON. Retry or handle the case manually.',
    );
  }
  return validateClassification(parsed, contextEvidence(context));
}
