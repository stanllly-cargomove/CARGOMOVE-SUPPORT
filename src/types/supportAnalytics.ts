export interface MetricGroup {
  name: string;
  count: number;
}
export interface SupportAnalytics {
  cohort: { from: string | null; to_exclusive: string | null };
  cases: {
    total: number;
    new: number;
    open: number;
    resolved: number;
    escalated: number;
    escalation_events: number;
  };
  ai: {
    classifications: number;
    suggested_drafts: number;
    knowledge_drafts: number;
    static_drafts: number;
    approved_unchanged: number;
    approved_edited: number;
    approved_unknown_comparison: number;
    confirmed_sends: number;
    classification_corrections: null;
  };
  response: {
    average_seconds: number | null;
    median_seconds: number | null;
    sample_cases: number;
    awaiting_first_response: number;
    without_inbound: number;
  };
  categories: MetricGroup[];
  subcategories: MetricGroup[];
  ports: MetricGroup[];
  daily_cases: Array<{ day: string; count: number }>;
  knowledge_usage: Array<{
    id: string;
    knowledge_code: string;
    title: string;
    active: boolean;
    drafts: number;
    sent_replies: number;
  }>;
}
