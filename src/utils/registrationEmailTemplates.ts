// Infer legacy built-ins only when an older API omits registration_type.
// An explicit null means the administrator assigned all registration types.
export const ASSET_ACCEPTANCE_TEMPLATES = [
  { id: 'acceptance-driver', type: 'DRIVER', label: 'Driver' },
  { id: 'acceptance-trailer', type: 'TRAILER', label: 'Trailer' },
  { id: 'acceptance-vehicle', type: 'VEHICLE', label: 'Vehicle' },
] as const;

export function emailTemplateRegistrationType(template: string | { id: string; registration_type?: string | null }): string | undefined {
  const templateId = typeof template === 'string' ? template : template.id;
  if (typeof template !== 'string' && template.registration_type !== undefined) return template.registration_type || undefined;
  if (['cargomove-welcome', 'rejection-already-registered-both', 'rejection-northport-added', 'rejection-no-ledger-code', 'rejection-other'].includes(templateId)) return 'COMPANY';
  return ASSET_ACCEPTANCE_TEMPLATES.find((template) => template.id === templateId)?.type;
}

export function isEmailTemplateForRegistration(template: { id: string; registration_type?: string | null }, registrationType: string): boolean {
  const type = emailTemplateRegistrationType(template);
  return !type || type === registrationType;
}
