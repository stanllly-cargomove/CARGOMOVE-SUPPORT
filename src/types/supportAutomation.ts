import type {
  SupportCategory,
  SupportSubcategory,
  KnowledgePort,
} from "./support";
export interface AutomationRule {
  id: string;
  category: SupportCategory;
  subcategory: SupportSubcategory | null;
  port: KnowledgePort;
  ai_analysis_enabled: boolean;
  ai_draft_enabled: boolean;
  auto_send_enabled: boolean;
  minimum_confidence: number;
  always_require_human: boolean;
  active: boolean;
  updated_at: string;
}
export type AutomationRuleInput = Omit<AutomationRule, "id" | "updated_at">;
export interface AutomationPolicy {
  rule: AutomationRule | null;
  can_auto_ack: boolean;
  status: string;
}
