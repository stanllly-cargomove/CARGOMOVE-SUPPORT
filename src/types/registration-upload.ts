export type RegistrationUploadState = 'PREPARING' | 'UPLOADING' | 'UPLOADED' | 'DISPATCHING' | 'PROCESSING' | 'SUCCESS' | 'FAILED' | 'UNKNOWN';
export interface RegistrationUploadSummary {
  id: string;
  state: RegistrationUploadState;
  filename: string;
  message: string;
  expectedRows: number;
  successCount: number | null;
  errorCount: number | null;
  updatedAt: string;
}
