// Built-in acceptance templates have a fixed purpose, just like the company
// welcome template. Custom codes remain available across registration types.
export const ASSET_ACCEPTANCE_TEMPLATES = [
  { id: 'acceptance-driver', type: 'DRIVER', label: 'Driver' },
  { id: 'acceptance-trailer', type: 'TRAILER', label: 'Trailer' },
  { id: 'acceptance-vehicle', type: 'VEHICLE', label: 'Vehicle' },
] as const;

export function emailTemplateRegistrationType(templateId: string): string | undefined {
  if (templateId === 'cargomove-welcome') return 'COMPANY';
  return ASSET_ACCEPTANCE_TEMPLATES.find((template) => template.id === templateId)?.type;
}

export function isEmailTemplateForRegistration(template: { id: string }, registrationType: string): boolean {
  const type = emailTemplateRegistrationType(template.id);
  return !type || type === registrationType;
}
