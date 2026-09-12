import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import {
  DEFAULT_HAULIER_GUIDELINE,
  INITIAL_COMPANIES,
  INITIAL_DEPOTS,
  INITIAL_PORTS,
  INITIAL_SUBMISSIONS,
} from '../src/services/storage';

config({ path: '.env.local' });

const configuredUrl = process.env.SUPABASE_URL?.trim();
const fallbackUrl = process.env.VITE_SUPABASE_URL?.trim();
const url = configuredUrl?.startsWith('http') ? configuredUrl : fallbackUrl;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceRoleKey) {
  throw new Error('Set a valid https:// Supabase project URL in SUPABASE_URL or VITE_SUPABASE_URL, plus SUPABASE_SERVICE_ROLE_KEY.');
}

const client = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
const companyRow = (company: typeof INITIAL_COMPANIES[number]) => {
  const {
    block, address1, address2, city, state, postcode, country, contact_name,
    contact_email, contact_designation, contact_mobile, office_phone, fax,
    ...master
  } = company;

  return {
  ...master,
  port_id: company.port_id === 'jh-pg-ics' || company.port_id === 'jh-pg-depot' ? 'johor-port' : company.port_id,
  details: {
    block, address1, address2, city, state, postcode, country, contact_name,
    contact_email, contact_designation, contact_mobile, office_phone, fax,
  },
  };
};
const submissionRow = (submission: typeof INITIAL_SUBMISSIONS[number]) => ({
  ...submission,
  company_id: submission.company_id || null,
});

const result = await client.from('port_configs').upsert(INITIAL_PORTS);
if (result.error) throw result.error;
const depots = await client.from('depot_configs').upsert(INITIAL_DEPOTS);
if (depots.error) throw depots.error;
const companies = await client.from('companies').upsert(INITIAL_COMPANIES.map(companyRow));
if (companies.error) throw companies.error;
const submissions = await client.from('registration_submissions').upsert(INITIAL_SUBMISSIONS.map(submissionRow));
if (submissions.error) throw submissions.error;
const guideline = await client.from('haulier_guidelines').upsert({ id: 'default', content: DEFAULT_HAULIER_GUIDELINE });
if (guideline.error) throw guideline.error;
console.log('Supabase seed complete.');