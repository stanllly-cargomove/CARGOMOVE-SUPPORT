import type {
  KnowledgePort,
  SupportCategory,
  SupportSubcategory,
} from './support';

export interface SupportKnowledge {
  id: string;
  knowledge_code: string;
  title: string;
  category: SupportCategory;
  subcategory: SupportSubcategory | null;
  port: KnowledgePort;
  problem: string;
  possible_cause: string | null;
  resolution: string;
  suggested_action: string | null;
  keywords: string[];
  requires_port_verification: boolean;
  human_review_required: boolean;
  ai_reply_allowed: boolean;
  active: boolean;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface SupportLearningSuggestion {
  id: string;
  category: SupportCategory;
  subcategory: SupportSubcategory | null;
  port: KnowledgePort;
  existing_knowledge_id: string | null;
  suggested_problem: string;
  suggested_resolution: string;
  suggested_action: string | null;
  evidence_count: number;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  reviewed_by: string | null;
  created_at: string;
  reviewed_at: string | null;
}

export type KnowledgeArticleInput = Pick<
  SupportKnowledge,
  | 'knowledge_code'
  | 'title'
  | 'category'
  | 'subcategory'
  | 'port'
  | 'problem'
  | 'possible_cause'
  | 'resolution'
  | 'suggested_action'
  | 'keywords'
  | 'requires_port_verification'
  | 'human_review_required'
  | 'ai_reply_allowed'
  | 'active'
>;
export interface KnowledgeFilters {
  q?: string;
  category?: string;
  subcategory?: string;
  port?: string;
  active?: string;
  ai_reply_allowed?: string;
  human_review_required?: string;
  offset?: number;
}
export interface KnowledgePage {
  articles: SupportKnowledge[];
  total: number;
}
export interface KnowledgeMatches {
  interaction_id: string | null;
  stale: boolean;
  articles: Array<SupportKnowledge & { match_score: number }>;
}

export const KNOWLEDGE_SUBCATEGORIES: Record<
  SupportCategory,
  readonly SupportSubcategory[]
> = {
  DRIVER: ['DRIVER_NOT_FOUND', 'PORT_PASS', 'DRIVER_REGISTRATION'],
  VEHICLE: ['VEHICLE_NOT_FOUND', 'LPK_REGISTRATION', 'VEHICLE_ACTIVATION'],
  BOOKING: [
    'CONVENTIONAL_BOOKING',
    'WAREHOUSE_BOOKING',
    'NON_CARGO_BOOKING',
    'BOOKING_CREATION',
    'EARLY_ENTRY',
  ],
  CONTAINER: [
    'CONTAINER_NOT_FOUND',
    'YARD_OPENING',
    'DG_DECLARATION',
    'VESSEL_CHANGE',
    'MT_PICKUP',
  ],
  PORT: ['PORT_CANCELLED'],
  ACCOUNT: ['ACCOUNT_EXISTS', 'LOGIN', 'PASSWORD', 'LOCATION_ACCESS'],
  REGISTRATION: [],
  SYSTEM: ['SYSTEM_OUTAGE', 'UNKNOWN_ERROR'],
  OTHER: [],
};

export const KNOWLEDGE_HIGH_RISK_SUBCATEGORIES = [
  'EARLY_ENTRY',
  'PORT_CANCELLED',
  'VESSEL_CHANGE',
  'UNKNOWN_ERROR',
  'CONTAINER_NOT_FOUND',
  'SYSTEM_OUTAGE',
  'YARD_OPENING',
  'DG_DECLARATION',
];
