export interface Delivery {
  approval_mode?: 'MANUAL' | 'AUTOMATIC_ACK';
  automation_rule_id?: string | null;
  id: string;
  case_id: string;
  draft_id: string;
  kind: "SEND" | "GMAIL_DRAFT";
  status: "IN_FLIGHT" | "UNKNOWN" | "FAILED" | "DONE";
  draft_version: string;
  context_fingerprint: string;
  mailbox_subject: string;
  mailbox_email: string;
  recipient_email: string;
  subject: string;
  reply_text: string;
  generated_reply: string;
  rfc_message_id: string;
  gmail_message_id: string | null;
  gmail_draft_id: string | null;
  requested_by: string;
  created_at: string;
  completed_at: string | null;
}
export interface CaseEvent {
  id: string;
  action: string;
  reason: string;
  actor_id: string;
  created_at: string;
  from_status: string;
  to_status: string;
}
export interface DeliveryState {
  recipient: string;
  deliveries: Delivery[];
  events: CaseEvent[];
}
