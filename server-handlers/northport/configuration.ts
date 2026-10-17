// Non-secret feature status shared by the API and deployment health check.
export const NORTHPORT_UPLOAD_GATES = ['READONLY_VERIFIED','SINGLE_RECORD_VERIFIED','FILENAME_VERIFIED','SERIALIZATION_VERIFIED','NON_NORTHPORT_VERIFIED','DUPLICATES_VERIFIED','RENAME_NO_REPLACE_VERIFIED','TIMEZONE_VERIFIED'] as const;
export const uploadsEnabled = () => process.env.NORTHPORT_RECOVERY_UPLOAD_ENABLED === 'true'
  && NORTHPORT_UPLOAD_GATES.every(gate => process.env[`NORTHPORT_${gate}`] === 'true');
