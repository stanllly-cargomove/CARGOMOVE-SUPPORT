import type {
  SupportCategory,
  SupportSubcategory,
  SupportPort,
  SupportUrgency,
} from './support';

export type SupportLanguage = 'EN' | 'MS' | 'MIXED_MS_EN' | 'UNKNOWN';
export interface SupportEntities {
  company_name: string | null;
  vehicle_number: string | null;
  driver_name: string | null;
  driver_identifier: string | null;
  container_number: string | null;
  booking_number: string | null;
  vessel: string | null;
  port: SupportPort | null;
  warehouse: string | null;
  error_message: string | null;
}

/** Contract only: future AI handlers must validate all fields server-side. */
export interface SupportClassification {
  category: SupportCategory;
  subcategory: SupportSubcategory | null;
  port: SupportPort;
  language: SupportLanguage;
  urgency: SupportUrgency;
  confidence: number;
  entities: SupportEntities;
  recommended_action: string | null;
  requires_human_review: boolean;
}

export interface AIInteraction extends Omit<SupportClassification, 'entities'> {
  id: string;
  case_id: string;
  message_id: string | null;
  model: string;
  prompt_version: string;
  // Storage may be empty before entity extraction is implemented.
  entities: Partial<SupportEntities>;
  short_explanation: string | null;
  knowledge_ids: string[];
  generated_reply: string | null;
  final_reply: string | null;
  was_edited: boolean | null;
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
}

export const SUPPORT_ACTIONS = [
  'REQUEST_INFORMATION',
  'VERIFY_WITH_PORT',
  'CHECK_REGISTRATION',
  'CHECK_BOOKING',
  'CHECK_CONTAINER',
  'REVIEW_KNOWLEDGE',
  'ESCALATE',
  'MANUAL_REVIEW',
] as const;
export type SupportAction = (typeof SUPPORT_ACTIONS)[number];
export interface ValidatedClassification extends Omit<
  SupportClassification,
  'recommended_action'
> {
  recommended_action: SupportAction;
  short_explanation: string;
}
export interface SupportAnalysisResult {
  interaction: AIInteraction;
  cached: boolean;
}

export const REPLY_TEMPLATES = [
  'KNOWLEDGE',
  'ACKNOWLEDGE',
  'REQUEST_DETAILS',
] as const;
export type ReplyTemplate = (typeof REPLY_TEMPLATES)[number];
export interface SupportReplyDraft {
  context_fingerprint: string;
  id: string;
  case_id: string;
  source_analysis_id: string;
  interaction_id: string;
  template_id: ReplyTemplate;
  edited_reply: string;
  created_at: string;
  updated_at: string;
  stale: boolean;
  interaction: AIInteraction;
  knowledge: import('./knowledge').SupportKnowledge[];
}
export interface StoredReply {
  draft: SupportReplyDraft | null;
}
