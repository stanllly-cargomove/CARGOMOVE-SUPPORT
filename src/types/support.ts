/** Database row shapes. UUIDs and timestamps are serialized strings. */
export const SUPPORT_CATEGORIES = ['DRIVER', 'VEHICLE', 'BOOKING', 'CONTAINER', 'PORT', 'ACCOUNT', 'REGISTRATION', 'SYSTEM', 'OTHER'] as const;
export const SUPPORT_SUBCATEGORIES = ['DRIVER_NOT_FOUND', 'PORT_PASS', 'DRIVER_REGISTRATION', 'VEHICLE_NOT_FOUND', 'LPK_REGISTRATION', 'VEHICLE_ACTIVATION', 'CONVENTIONAL_BOOKING', 'WAREHOUSE_BOOKING', 'NON_CARGO_BOOKING', 'BOOKING_CREATION', 'CONTAINER_NOT_FOUND', 'YARD_OPENING', 'EARLY_ENTRY', 'DG_DECLARATION', 'VESSEL_CHANGE', 'MT_PICKUP', 'ACCOUNT_EXISTS', 'LOGIN', 'PASSWORD', 'LOCATION_ACCESS', 'PORT_CANCELLED', 'SYSTEM_OUTAGE', 'UNKNOWN_ERROR'] as const;
export const SUPPORT_PORTS = ['WESTPORT', 'NORTHPORT', 'KUANTANPORT', 'UNKNOWN'] as const;
export const SUPPORT_STATUSES = ['NEW', 'ANALYZING', 'DRAFTED', 'NEEDS_REVIEW', 'WAITING_CUSTOMER', 'ESCALATED', 'RESOLVED'] as const;
export const SUPPORT_URGENCIES = ['LOW', 'NORMAL', 'HIGH', 'CRITICAL'] as const;

export type SupportCategory = typeof SUPPORT_CATEGORIES[number];
export type SupportSubcategory = typeof SUPPORT_SUBCATEGORIES[number];
export type SupportPort = typeof SUPPORT_PORTS[number];
export type SupportStatus = typeof SUPPORT_STATUSES[number];
export type SupportUrgency = typeof SUPPORT_URGENCIES[number];
export type KnowledgePort = SupportPort | 'ALL';

export interface SupportCase {
  id: string;
  gmail_thread_id: string | null;
  customer_name: string | null;
  customer_email: string;
  subject: string;
  status: SupportStatus;
  category: SupportCategory;
  subcategory: SupportSubcategory | null;
  port: SupportPort;
  urgency: SupportUrgency;
  ai_confidence: number | null;
  assigned_to: string | null;
  assigned_name?: string | null;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
}

export interface SupportMessage {
  id: string;
  case_id: string;
  gmail_message_id: string | null;
  gmail_thread_id: string | null;
  direction: 'INBOUND' | 'OUTBOUND';
  sender_name: string | null;
  sender_email: string;
  recipient_email: string;
  subject: string;
  body_text: string;
  /** Untrusted content: must be sanitized before any HTML rendering. */
  body_html: string | null;
  sent_at: string;
  created_at: string;
}

export interface SupportAutomationRule {
  id: string;
  category: SupportCategory;
  subcategory: SupportSubcategory | null;
  port: KnowledgePort;
  ai_analysis_enabled: boolean;
  ai_draft_enabled: boolean;
  /** Milestone 1 enforces human review at the database level. */
  auto_send_enabled: false;
  minimum_confidence: number;
  always_require_human: true;
  active: boolean;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface SupportCaseRow extends SupportCase {
  preview: string | null;
  last_message_at: string | null;
}
export interface SupportCaseFilters {
  q?: string;
  status?: SupportStatus | '';
  category?: SupportCategory | '';
  port?: SupportPort | '';
  assigned_to?: string;
  confidence?: 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE' | '';
  from?: string;
  to?: string;
  offset?: number;
}
export interface SupportCasePage { cases: SupportCaseRow[]; total: number; assignees: Array<{ id: string; name: string; email: string }> }
export interface SupportStats {
  new_cases: number;
  open_cases: number;
  need_review: number;
  ai_drafts: number;
  resolved_today: number;
  total_cases: number;
  categories: Array<{ name: SupportCategory; count: number }>;
  ports: Array<{ name: SupportPort; count: number }>;
}
