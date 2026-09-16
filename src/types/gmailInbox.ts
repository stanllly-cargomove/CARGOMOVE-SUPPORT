export interface GmailMessageReference { id: string; threadId: string }
export interface GmailMessagePage {
  messages: GmailMessageReference[];
  nextPageToken: string | null;
}
export interface GmailInboxMessage {
  gmail_message_id: string;
  gmail_thread_id: string;
  direction: 'INBOUND' | 'OUTBOUND';
  sender_name: string | null;
  sender_email: string;
  recipient_email: string;
  subject: string;
  body_text: string;
  /** Sanitized server-side; still treat email content as untrusted. */
  body_html: string | null;
  sent_at: string;
  in_inbox: boolean;
}
export interface GmailInboxThread { id: string; messages: GmailInboxMessage[] }
export interface GmailSyncResult {
  mode: 'BOOTSTRAP' | 'HISTORY';
  processed_threads: number;
  inserted_messages: number;
  has_more: boolean;
  history_id: string | null;
}
