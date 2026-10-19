export const NORTHPORT_COLUMNS = ['UNIT','GPNO','EXPNO','BLNO','SRV','SZ','HAUL','FE','YLOC','SCN','DG','TERMINAL','SOLAST','RETURNLOC','MGW','MODE','STACKTIME','VGM','FWDCD','OPRCD'] as const;
export type ContainerType = 'GP' | 'EX';
export const NORTHPORT_SEARCH_MODES = [
  { value: 'standard', label: 'Basic Scan (Fast)', description: 'Quickly find matching containers in valid CSV files.' },
  { value: 'files', label: 'Advanced Scan (Enhanced)', description: 'Scan all discovered files and show matches and validation results.' },
  { value: 'content', label: 'Deep Scan (Maximum)', description: 'Search file contents, including files that cannot be parsed normally.' },
] as const;
export type SearchMode = typeof NORTHPORT_SEARCH_MODES[number]['value'];
export type ScannedFile = { filename: string; timestamp: string; type: ContainerType; bytes: number; records: number; matches: number; status: 'match' | 'no-match' | 'invalid' | 'content-match'; error?: string; token: string };
export type Match = { filename: string; timestamp: string; type: ContainerType; record: number; totalRecords?: number; fileToken?: string; values: string[]; token: string };
export type Recovery = { id: string; container: string; container_type: ContainerType; source_filename: string; recovery_filename: string; submitted_by: string; created_at: string; changed_fields: string[]; status: string; scheduler_run_id?: string; scheduler_status?: string; processing_result?: string };
