import { createClient } from '@supabase/supabase-js';
import { ASSET_ACCEPTANCE_TEMPLATES } from '../src/utils/registrationEmailTemplates.js';

process.loadEnvFile?.('.env.local');
const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error('Supabase URL and service role key are required.');
const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const apply = process.argv.includes('--apply');
const [{ data: templates, error }, { data: ports, error: portError }] = await Promise.all([
  client.from('email_templates').select('id,template_code,trigger_status,active'),
  client.from('port_configs').select('id').eq('active', true),
]);
if (error || portError) throw error || portError;
if (!ports?.length) throw new Error('No active ports are configured.');
const usedCodes = new Set(templates?.map((template) => template.template_code));

for (const definition of ASSET_ACCEPTANCE_TEMPLATES) {
  const existing = templates?.find((template) => template.id === definition.id);
  if (existing && (existing.trigger_status !== 'DONE' || !existing.template_code || !existing.active)) {
    throw new Error(`${definition.id} exists with a different outcome or is inactive. Review it before continuing.`);
  }
  const code = existing?.template_code || Array.from({ length: 999 }, (_, index) => `ACC${String(index + 1).padStart(3, '0')}`).find((value) => !usedCodes.has(value));
  if (!code) throw new Error('No acceptance code numbers are available.');
  usedCodes.add(code);
  if (apply) {
    if (!existing) {
      const { error: createError } = await client.from('email_templates').insert({
        id: definition.id,
        name: `${definition.label} Registration Acceptance`,
        template_code: code,
        trigger_status: 'DONE',
        recipient_template: '{{user.email}}',
        subject_template: `CargoMove ${definition.label.toLowerCase()} registration approved`,
        body_template: `<p>Dear Customer,</p><p>Your ${definition.label.toLowerCase()} registration has been approved and is now complete.</p><p>Please refer to the attached PDF for the registered ${definition.label.toLowerCase()} details.</p><p>If you notice an issue, error, or incorrect registration data, please contact CargoMove Support through our <strong>Official WhatsApp:</strong> 018-266 0085</p><p>Regards,<br>CargoMove Support Team</p>`,
        // The existing preview/send handlers generate the registration PDF.
        attachments: [],
        active: true,
        version: 1,
      });
      if (createError) throw createError;
    }
    const { error: assignmentError } = await client.from('email_template_ports').upsert(ports.map((port) => ({ template_id: definition.id, port_id: port.id })));
    if (assignmentError) throw assignmentError;
  }
  console.log(`${apply ? 'Configured' : 'Would configure'} ${code}: ${definition.label} Registration Acceptance (${ports.length} active ports, generated registration PDF).`);
}
if (!apply) console.log('Run with --apply to create the codes. Existing template content is preserved.');
