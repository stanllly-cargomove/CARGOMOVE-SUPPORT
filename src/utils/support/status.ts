import type { SupportStatus } from '../../types/support';
import { formatAdminDateTime } from '../date';
export const SUPPORT_STATUS_LABELS: Record<SupportStatus, string> = {
  NEW: 'New',
  ANALYZING: 'Analyzing',
  DRAFTED: 'AI drafted',
  NEEDS_REVIEW: 'Needs review',
  WAITING_CUSTOMER: 'Waiting customer',
  ESCALATED: 'Escalated',
  RESOLVED: 'Resolved',
};
export function supportLabel(value: string): string {
  return value
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
export function supportTime(value: string | null): string {
  return value ? formatAdminDateTime(value) : '-';
}
