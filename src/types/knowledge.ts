import type { KnowledgePort, SupportCategory, SupportSubcategory } from './support';

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
