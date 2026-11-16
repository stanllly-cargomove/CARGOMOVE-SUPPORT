// Westports columns and local timestamp text are retained as supplied by ETP.
// Do not infer Northport categories or event meanings from Westports order codes.
export type WestportTable = { columns: string[]; movements: string[][] };
export type WestportDetailSection = { title: string; columns: string[]; rows: string[][] };
export type WestportDetailRequest = { sourceIndex: number; movementKey: string };
export type WestportQueryResult = WestportTable & {
  success: true;
  port: 'westport';
  containerNumber: string;
  queriedAt: string;
  totalMovements: number;
  movementKeys?: string[];
  detail?: WestportDetailSection[];
};
