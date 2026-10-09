import { adminClient, missingVariables, requestBody } from '../../api/_runtime.js';
import { createRawMessage, decryptRefreshToken, exchangeRefreshToken } from '../_email.js';

const registrationTypes = new Set(['COMPANY', 'DRIVER', 'TRAILER', 'VEHICLE']);
const portLocations = new Set(['PORT_KLANG', 'JOHOR', 'OTHER']);
const companyTypesByLocation: Record<string, Set<string>> = {
  PORT_KLANG: new Set(['TRANSPORT', 'FORWARDER']),
  JOHOR: new Set(['TRANSPORT', 'FORWARDER', 'HAULAGE']),
  OTHER: new Set(['TRANSPORT', 'FORWARDER', 'HAULAGE']),
};
const CONSENT_NOTICE_VERSION = '2026-09-15';
const OLD_COMPANY_REGISTRATION_NUMBER_PATTERN = /^[A-Z0-9-]+$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const companyFields = [
  'registration_number',
  'registration_number_old',
  'registration_number_new',
  'name',
  'short_name',
  'company_type',
  'haulier_id',
  'forwarding_agent_id',
  'ledger_codes',
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

async function sendSubmissionConfirmation(client: NonNullable<ReturnType<typeof adminClient>>, recipients: string[], registrationType: string, referenceNo: string, companyName: string) {
  const connectionResult = await client.from('gmail_connections').select('*').eq('id', 'system').eq('status', 'ACTIVE').maybeSingle();
  if (connectionResult.error || !connectionResult.data) return { status: 'NOT_SENT', error: connectionResult.error?.message || 'No active CargoMove email account is connected.' };

  try {
    const accessToken = await exchangeRefreshToken(decryptRefreshToken(connectionResult.data));
    const assetLabel = registrationType.charAt(0) + registrationType.slice(1).toLowerCase();
    const subject = `CargoMove registration received — ${referenceNo}`;
    const body = `<p>Dear Customer,</p><p>We have received your ${assetLabel} registration for <strong>${companyName}</strong>.</p><p>Reference number: <strong>${referenceNo}</strong></p><p>Your submission is pending review by the CargoMove team. We will contact you if any further information is needed.</p><p>Regards,<br>CargoMove</p>`;
    for (const recipient of recipients) {
      const gmailResponse = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ raw: createRawMessage(connectionResult.data.email, recipient, subject, body) }),
      });
      const gmailMessage = await gmailResponse.json().catch(() => ({}));
      if (!gmailResponse.ok || !gmailMessage.id) throw new Error(String(gmailMessage.error?.status || gmailMessage.error?.message || 'gmail_send_failed'));
    }
    return { status: 'SENT' };
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 300) : 'Unable to send the confirmation email.';
    console.error('Registration confirmation email failed:', message);
    return { status: 'FAILED', error: message };
  }
}

async function nextReferenceNo(client: NonNullable<ReturnType<typeof adminClient>>) {
  const { data, error } = await client.rpc('next_registration_reference_no', {});
  if (error || typeof data !== 'string' || !data) {
    throw new RegistrationWriteError('reference number', error || { message: 'The database did not return a reference number.' });
  }
  return data;
}

function databaseFailureDetails(writeError: RegistrationWriteError) {
  const databaseError = writeError.databaseError || {};
  const code = text(databaseError.code) || 'REGISTRATION_WRITE_FAILED';
  const constraint = text(databaseError.constraint);
  const rawDetails = text(databaseError.details || databaseError.message);

  if (code === '23505') {
    return {
      status: 409,
      error: 'This registration conflicts with an existing record.',
      details: constraint.includes('username')
        ? 'The requested username is already registered.'
        : constraint.includes('email')
          ? 'The requested email address is already registered.'
          : 'The company registration number, username, or email already exists.',
      hint: 'Return to the relevant form page and use a unique value.',
      code,
    };
  }
  if (code === '23503') {
    return {
      status: 400,
      error: `Unable to save ${writeError.step} because a configured port or depot could not be matched.`,
      details: rawDetails || 'A referenced port or depot does not exist in the current configuration.',
      hint: 'Download a fresh form template or leave system-managed port and depot IDs blank.',
      code,
    };
  }
  if (code === '23502') {
    return {
      status: 422,
      error: `Unable to save ${writeError.step} because a required value is missing.`,
      details: rawDetails,
      hint: 'Return to the form and complete the highlighted required field.',
      code,
    };
  }

  return {
    status: 400,
    error: `Unable to save ${writeError.step}.`,
    details: rawDetails || 'The database rejected the submitted record.',
    hint: text(databaseError.hint) || 'Review the submitted values and try again. If the issue continues, contact support with this error code.',
    code,
  };
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
  const additionalConfirmationEmail = text(body?.additional_confirmation_email).toLowerCase();

  if (!body || !registrationTypes.has(registrationType) || !portLocations.has(portLocation) || !portId) {
    response.status(400).json({ error: 'Registration type, port location, and a valid database port are required.' });
    return;
  }
  if (!declarationAccepted || !dataProcessingAccepted) {
    response.status(400).json({ error: 'Both the accuracy declaration and data-processing consent are required.' });
    return;
  }
  if (additionalConfirmationEmail && !EMAIL_PATTERN.test(additionalConfirmationEmail)) {
    response.status(422).json({ error: 'The additional confirmation email is invalid.' });
    return;
  }
  if (registrationType === 'COMPANY' && (!companyInput || !userInput)) {
    response.status(400).json({ error: 'Company details and user access details are required.' });
    return;
  }

  const now = new Date();
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
    // The database sequence is the single source of truth. This is atomic, so
    // concurrent submissions cannot receive the same CMREG number.
    const referenceNo = await nextReferenceNo(client);
    if (registrationType === 'COMPANY') {
      const registrationNumber = text(companyInput.registration_number_old || companyInput.registration_number || companyInput.registration_number_new).toUpperCase();
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
      if (!OLD_COMPANY_REGISTRATION_NUMBER_PATTERN.test(registrationNumber)) {
        response.status(422).json({
          error: 'The old company registration number is invalid.',
          details: 'Use only letters, numbers, and hyphens (-). Spaces and other symbols are not allowed.',
          code: 'COMPANY_REGISTRATION_NUMBER_INVALID',
        });
        return;
      }

      const requiredCompanyValues = [
        ['Company short name', companyInput.short_name],
        ['Address line 1', companyInput.address1],
        ['City', companyInput.city],
        ['State or region', companyInput.state],
        ['Postcode', companyInput.postcode],
        ['Country', companyInput.country],
        ['Contact person name', companyInput.contact_name],
        ['Contact email', companyInput.contact_email],
        ['Contact mobile number', companyInput.contact_mobile],
      ] as const;
      const missingCompanyFields = requiredCompanyValues.filter(([, value]) => !text(value)).map(([label]) => label);
      if (missingCompanyFields.length > 0) {
        response.status(422).json({
          error: 'Required company details are missing.',
          details: `Missing fields: ${missingCompanyFields.join(', ')}.`,
          hint: 'Return to the company form and complete these fields before submitting.',
          code: 'COMPANY_VALIDATION_FAILED',
        });
        return;
      }
      if (!/^\S+@\S+\.\S+$/.test(text(companyInput.contact_email))) {
        response.status(422).json({
          error: 'The company contact email is invalid.',
          details: `Received: ${text(companyInput.contact_email) || '(blank)'}.`,
          hint: 'Enter a complete email address such as name@company.com.',
          code: 'COMPANY_EMAIL_INVALID',
        });
        return;
      }

      if (portLocation === 'PORT_KLANG') {
        const selectedPortIds = Array.isArray(companyInput.assigned_port_ids)
          ? companyInput.assigned_port_ids.map(text).filter(Boolean)
          : [];
        const ledgerCodes = text(companyInput.ledger_codes).split(',').map((code) => code.trim()).filter(Boolean);
        if (!selectedPortIds.length || ledgerCodes.length !== selectedPortIds.length) {
          response.status(422).json({
            error: 'Choose at least one Port Klang terminal and enter a ledger code for each selected terminal.',
            code: 'PORT_KLANG_LEDGER_CODES_INVALID',
          });
          return;
        }
        if (portId !== selectedPortIds[0]) {
          response.status(422).json({ error: 'The primary port must match the first selected terminal.', code: 'PORT_KLANG_PRIMARY_PORT_INVALID' });
          return;
        }
        const selectedPorts = await client.from('port_configs').select('id,location,code');
        if (selectedPorts.error) throw new RegistrationWriteError('port validation', selectedPorts.error);
        const selectedIds = new Set((selectedPorts.data || [])
          .filter((port: any) => selectedPortIds.includes(text(port.id)) && text(port.location) === 'PORT_KLANG' && ['WESTPORT', 'NORTHPORT'].includes(text(port.code)))
          .map((port: any) => text(port.id)));
        if (selectedIds.size !== selectedPortIds.length || selectedPortIds.some((id) => !selectedIds.has(id))) {
          response.status(422).json({ error: 'Only configured Westport and Northport terminals can be selected.', code: 'PORT_KLANG_PORT_INVALID' });
          return;
        }
      }

      let resolvedDepotId: string | null = null;
      const requestedDepotId = optionalText(companyInput.depot_id || body.depot_id);
      if (requestedDepotId) {
        let depotResult = await client.from('depot_configs').select('*').eq('id', requestedDepotId).maybeSingle();
        if (depotResult.error) throw new RegistrationWriteError('depot validation', depotResult.error);
        if (!depotResult.data) {
          depotResult = await client.from('depot_configs').select('*').eq('backend_depot_id', requestedDepotId).maybeSingle();
          if (depotResult.error) throw new RegistrationWriteError('depot validation', depotResult.error);
        }
        if (!depotResult.data) {
          response.status(422).json({
            error: 'The imported depot ID is not recognized.',
            details: `No configured depot matches "${requestedDepotId}".`,
            hint: 'Download a fresh template or leave Depot ID blank; CargoMove will use the configured facility.',
            code: 'DEPOT_NOT_FOUND',
          });
          return;
        }
        if (text(depotResult.data.port_id) !== portId) {
          response.status(422).json({
            error: 'The imported depot does not belong to the selected port.',
            details: `Depot "${requestedDepotId}" is linked to a different port configuration.`,
            hint: 'Choose the matching port or leave Depot ID blank.',
            code: 'DEPOT_PORT_MISMATCH',
          });
          return;
        }
        resolvedDepotId = text(depotResult.data.id);
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
        details: {
          assigned_port_ids: Array.isArray(companyInput.assigned_port_ids) ? companyInput.assigned_port_ids : [],
          assigned_depot_ids: Array.isArray(companyInput.assigned_depot_ids) ? companyInput.assigned_depot_ids : [],
        },
        status: 'ACTIVE',
        created_at: now.toISOString(),
        updated_at: now.toISOString(),
      };
      companyFields.forEach((field) => {
        companyRow[field] = field === 'port_id'
          ? portId
        : field === 'registration_number_old'
          ? text(companyInput[field]).toUpperCase()
          : field === 'depot_id'
            ? optionalText(companyInput[field])
            : text(companyInput[field]);
      });
      companyRow.registration_number = registrationNumber;
      companyRow.name = companyName;
      companyRow.short_name = text(companyInput.short_name).toUpperCase();
      companyRow.depot_id = resolvedDepotId;

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
        depot_id: resolvedDepotId,
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

    const accountResult = await client.from('external_user_access')
      .select('email')
      .eq('company_id', companyId)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();
    if (accountResult.error) throw new RegistrationWriteError('registered account email', accountResult.error);
    const companyEmailResult = await client.from('companies').select('contact_email,details').eq('id', companyId).maybeSingle();
    if (companyEmailResult.error) throw new RegistrationWriteError('company notification email', companyEmailResult.error);
    const accountEmail = text(accountResult.data?.email).toLowerCase();
    const savedCompanyEmail = text(
      companyEmailResult.data?.contact_email
      || (companyEmailResult.data?.details as Record<string, unknown> | null)?.contact_email,
    ).toLowerCase();
    const registeredEmail = accountEmail || savedCompanyEmail || additionalConfirmationEmail;
    if (!EMAIL_PATTERN.test(registeredEmail)) {
      response.status(422).json({ error: 'Add a valid email address before submitting so registration updates can be sent.' });
      return;
    }
    const confirmationRecipients = Array.from(new Set([registeredEmail, (accountEmail || savedCompanyEmail) ? additionalConfirmationEmail : ''].filter(Boolean)));
    submittedData.email_confirmation = {
      recipients: confirmationRecipients,
      requested_at: now.toISOString(),
      delivery_status: 'PENDING',
    };

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
      notification_email: additionalConfirmationEmail || null,
      data: submittedData,
    };
    const submissionResult = await client.from('registration_submissions').insert(submissionRow).select().single();
    if (submissionResult.error) throw new RegistrationWriteError('registration submission', submissionResult.error);
    submissionCreated = true;
    if (!accountEmail && !savedCompanyEmail) {
      const companyEmailUpdate = await client.from('companies').update({ contact_email: registeredEmail }).eq('id', companyId);
      if (companyEmailUpdate.error) throw new RegistrationWriteError('company notification email', companyEmailUpdate.error);
    }
    const emailDelivery = await sendSubmissionConfirmation(client, confirmationRecipients, registrationType, referenceNo, text(body.company_name).toUpperCase());
    submittedData.email_confirmation = {
      ...submittedData.email_confirmation,
      delivery_status: emailDelivery.status,
      ...(emailDelivery.error ? { delivery_error: emailDelivery.error } : {}),
    };
    const deliveryUpdate = await client.from('registration_submissions').update({ data: submittedData }).eq('id', submissionId).select().single();
    if (deliveryUpdate.error) console.error('Registration email delivery status update failed:', deliveryUpdate.error);
    response.status(201).json({ company: null, submission: deliveryUpdate.data || submissionResult.data, user: null, emailDelivery });
  } catch (error) {
    if (submissionCreated) await removeCreatedRow(client, 'registration_submissions', submissionId);
    if (companyCreated) await removeCreatedRow(client, 'companies', companyId);
    const writeError = error instanceof RegistrationWriteError ? error : new RegistrationWriteError('registration', error);
    console.error('Company registration failed:', { step: writeError.step, error: writeError.databaseError });
    const failure = databaseFailureDetails(writeError);
    response.status(failure.status).json({
      error: failure.error,
      details: failure.details,
      hint: failure.hint,
      code: failure.code,
      step: writeError.step,
    });
  }
}
