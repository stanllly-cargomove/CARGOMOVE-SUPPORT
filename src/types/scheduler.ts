export interface SavedScheduler {
  id: string;
  displayName: string;
  workerName: string;
  origin: string;
  description: string;
  url: string;
  enabled: boolean;
  lastRun: { status: string; requestedAt: string; triggeredBy: string | null } | null;
}
