export const NORTHPORT_COLUMNS = ['UNIT','GPNO','EXPNO','BLNO','SRV','SZ','HAUL','FE','YLOC','SCN','DG','TERMINAL','SOLAST','RETURNLOC','MGW','MODE','STACKTIME','VGM','FWDCD','OPRCD'] as const;
export type ContainerType = 'GP' | 'EX';
export type Match = { filename: string; timestamp: string; type: ContainerType; record: number; values: string[]; token: string };
export type Recovery = { id: string; container: string; container_type: ContainerType; source_filename: string; recovery_filename: string; submitted_by: string; created_at: string; changed_fields: string[]; status: string; scheduler_run_id?: string; scheduler_status?: string; processing_result?: string };
