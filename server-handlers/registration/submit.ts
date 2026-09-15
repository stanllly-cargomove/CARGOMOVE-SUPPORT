import crypto from 'node:crypto';
import { adminClient, missingVariables, requestBody } from '../../api/_runtime.js';

const registrationTypes = new Set(['COMPANY', 'DRIVER', 'TRAILER', 'VEHICLE']);
const portLocations = new Set(['PORT_KLANG', 'JOHOR', 'OTHER']);
const companyTypesByLocation: Record<string, Set<string>> = {
  PORT_KLANG: new Set(['TRANSPORT', 'FORWARDER']),
  JOHOR: new Set(['TRANSPORT', 'FORWARDER', 'HAULAGE']),
  OTHER: new Set(['TRANSPORT', 'FORWARDER', 'HAULAGE']),
};
const CONSENT_NOTICE_VERSION = '2026-09-15';
const companyFields = [
  'registration_number',
  'registration_number_old',
  'registration_number_new',
  'name',
  'short_name',
  'company_type',
  'haulier_id',
  'forwarding_agent_id',
  'port_id',
  'depot_id',
  'block',
  'address1',
  'address2',
  'city',
  'state',
  'postcode',
  'country',
  'contact_name',
  'contact_email',
  'contact_designation',
  'contact_mobile',
  'office_phone',
  'fax',
] as const;

class RegistrationWriteError extends Error {
  constructor(readonly step: string, readonly databaseError: any) {
    super(databaseError?.message || `Unable to save ${step}.`);
  }
}

function text(value: unknown) {
  return String(value ?? '').trim();
}

function optionalText(value: unknown) {
  const valueText = text(value);
  return valueText || null;
}

async function removeCreatedRow(client: NonNullable<ReturnType<typeof adminClient>>, table: string, id: string) {
  const { error } = await client.from(table).delete().eq('id', id);
  if (error) console.error('Company registration rollback failed:', { table, id, error });
}

export default async function companyRegistration(request: any, response: any) {
  if (request.method !== 'POST') {
    response.status(405).json({ error: 'Method not allowed.' });
    return;
  }

  const client = adminClient();
  if (!client) {
    response.status(503).json({ error: 'Supabase server access is not configured.', missing: missingVariables });
    return;
  }

  const body = await requestBody(request).catch(() => null) as any;
  const registrationType = text(body?.registration_type).toUpperCase();
  const portLocation = text(body?.port_location).toUpperCase();
  const portId = text(body?.port_id);
  const companyInput = body?.company && typeof body.company === 'object' ? body.company : null;
  const userInput = body?.user_access && typeof body.user_access === 'object' ? body.user_access : null;
  const declarationAccepted = body?.declaration_accepted === true;
  const dataProcessingAccepted = body?.data_processing_consent === true;

  if (!body || !registrationTypes.has(registrationType) || !portLocations.has(portLocation) || !portId) {
    response.status(400).json({ error: 'Registration type, port location, and a valid database port are required.' });
    return;
  }
  if (!declarationAccepted || !dataProcessingAccepted) {
    response.status(400).json({ error: 'Both the accuracy declaration and data-processing consent are required.' });
    return;
  }
  if (registrationType === 'COMPANY' && (!companyInput || !userInput)) {
    response.status(400).json({ error: 'Company details and user access details are required.' });
    return;
  }

  const now = new Date();
  const datePart = now.toISOString().slice(0, 10).replace(/-/g, '');
  // The reference acts as the customer's lookup key, so keep enough entropy to
  // prevent other applications from being guessed through the public tracker.
  const referenceNo = `REG-${datePart}-${crypto.randomBytes(6).toString('hex').toUpperCase()}`;
  const uniquePart = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  let companyId = registrationType === 'COMPANY' ? `comp-${uniquePart}` : text(body.company_id);
  const submissionId = `sub-${uniquePart}`;
  const externalUserId = `external-user-${uniquePart}`;
  const submittedData = {
    ...(body.data && typeof body.data === 'object' ? body.data : {}),
    consent: {
      declaration_accepted: true,
      data_processing_accepted: true,
      accepted_at: now.toISOString(),
      notice_version: CONSENT_NOTICE_VERSION,
    },
  };

  if (!companyId) {
    response.status(400).json({ error: 'A registered company is required for this registration type.' });
    return;
  }

  let company: any = null;
  let submission: any = null;
  let companyCreated = false;
  let submissionCreated = false;

  try {
    if (registrationType === 'COMPANY') {
      const registrationNumber = text(companyInput.registration_number_old || companyInput.registration_number || companyInput.registration_number_new);
      const companyName = text(companyInput.name).toUpperCase();
      const companyType = text(companyInput.company_type).toUpperCase();
      const username = text(userInput.username).toLowerCase();
      const email = text(userInput.email).toLowerCase();
      const password = String(userInput.password || '');
      const fullName = text(userInput.full_name);
      const mobileNumber = text(userInput.mobile_number);
      if (!registrationNumber || !companyName || !companyType) {
        response.status(400).json({ error: 'Company name, type, and registration number are required.' });
        return;
      }
      if (!companyTypesByLocation[portLocation].has(companyType)) {
        const facilityLabel = portLocation === 'PORT_KLANG'
          ? 'Port Klang'
          : portLocation === 'JOHOR'
            ? 'Johor Depot'
            : 'the selected facility';
        response.status(400).json({
          error: `${companyType} is not an available company category for ${facilityLabel}.`,
        });
        return;
      }
      if (!username || !email || !email.includes('@') || password.length < 6 || !fullName || !mobileNumber) {
        response.status(400).json({ error: 'Complete and valid user access details are required.' });
        return;
      }

      const byUsername = await client.from('external_user_access').select('*').eq('username', username).maybeSingle();
      if (byUsername.error) throw new RegistrationWriteError('existing user check', byUsername.error);
      const byEmail = byUsername.data
        ? { data: null, error: null }
        : await client.from('external_user_access').select('*').eq('email', email).maybeSingle();
      if (byEmail.error) throw new RegistrationWriteError('existing user check', byEmail.error);
      const existingUser = byUsername.data || byEmail.data;
      if (existingUser && (text(existingUser.username).toLowerCase() !== username || text(existingUser.email).toLowerCase() !== email)) {
        response.status(409).json({ error: 'That username or email is already registered.' });
        return;
      }
      if (existingUser) {
        const existingCompanyId = text(existingUser.company_id);
        if (existingCompanyId) companyId = existingCompanyId;
        const linkedCompany = await client.from('companies').select('id').eq('id', companyId).maybeSingle();
        if (linkedCompany.error) throw new RegistrationWriteError('existing company check', linkedCompany.error);
        if (linkedCompany.data) {
          response.status(409).json({ error: 'That username or email is already registered.' });
          return;
        }
      }

      const companyRow: Record<string, unknown> = {
        id: companyId,
        status: 'ACTIVE',
        created_at: now.toISOString(),
        updated_at: now.toISOString(),
      };
      companyFields.forEach((field) => {
        companyRow[field] = field === 'port_id'
          ? portId
          : field === 'depot_id'
            ? optionalText(companyInput[field])
            : text(companyInput[field]);
      });
      companyRow.registration_number = registrationNumber;
      companyRow.name = companyName;
      companyRow.short_name = text(companyInput.short_name).toUpperCase();

      const companyResult = await client.from('companies').insert(companyRow).select().single();
      if (companyResult.error) throw new RegistrationWriteError('company details', companyResult.error);
      company = companyResult.data;
      companyCreated = true;

      const submissionRow = {
        id: submissionId,
        reference_no: referenceNo,
        registration_type: registrationType,
        company_id: companyId,
        company_reg_no: registrationNumber,
        company_name: companyName,
        company_type: companyType,
        port_location: portLocation,
        port_id: portId,
        depot_id: optionalText(companyInput.depot_id),
        status: 'PENDING',
        submitted_at: now.toISOString(),
        submitted_by_name: text(companyInput.contact_name),
        submitted_by_email: text(companyInput.contact_email),
        submitted_by_mobile: text(companyInput.contact_mobile),
        data: submittedData,
      };
      const submissionResult = await client.from('registration_submissions').insert(submissionRow).select().single();
      if (submissionResult.error) throw new RegistrationWriteError('registration submission', submissionResult.error);
      submission = submissionResult.data;
      submissionCreated = true;

      const externalUserPayload = {
        username,
        email,
        password,
        company_id: companyId,
        company_name: companyName,
        full_name: fullName,
        mobile_number: mobileNumber,
      };
      const externalUserResult = existingUser
        ? await client.from('external_user_access').update(externalUserPayload).eq('id', existingUser.id).select().single()
        : await client.from('external_user_access').insert({ id: externalUserId, ...externalUserPayload }).select().single();
      if (externalUserResult.error) throw new RegistrationWriteError('external user access', externalUserResult.error);

      response.status(201).json({ company, submission, user: externalUserResult.data });
      return;
    }

    const submissionRow = {
      id: submissionId,
      reference_no: referenceNo,
      registration_type: registrationType,
      company_id: companyId,
      company_reg_no: text(body.company_reg_no),
      company_name: text(body.company_name).toUpperCase(),
      company_type: text(body.company_type),
      port_location: portLocation,
      port_id: portId,
      depot_id: optionalText(body.depot_id),
      status: 'PENDING',
      submitted_at: now.toISOString(),
      submitted_by_name: text(body.submitted_by_name),
      submitted_by_email: text(body.submitted_by_email),
      submitted_by_mobile: text(body.submitted_by_mobile),
      data: submittedData,
    };
    const submissionResult = await client.from('registration_submissions').insert(submissionRow).select().single();
    if (submissionResult.error) throw new RegistrationWriteError('registration submission', submissionResult.error);
    response.status(201).json({ company: null, submission: submissionResult.data, user: null });
  } catch (error) {
    if (submissionCreated) await removeCreatedRow(client, 'registration_submissions', submissionId);
    if (companyCreated) await removeCreatedRow(client, 'companies', companyId);
    const writeError = error instanceof RegistrationWriteError ? error : new RegistrationWriteError('registration', error);
    console.error('Company registration failed:', { step: writeError.step, error: writeError.databaseError });
    response.status(writeError.databaseError?.code === '23505' ? 409 : 400).json({
      error: writeError.databaseError?.code === '23505'
        ? 'That company registration, username, or email already exists.'
        : `Unable to save ${writeError.step}. Please verify the form and try again.`,
    });
  }
}
