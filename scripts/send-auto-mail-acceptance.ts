// Explicit owner-operated acceptance message; never invoked by tests or startup.
// Uses the connected administrator as the responsible actor and existing outbox admission.
import crypto from 'node:crypto';
import dotenv from 'dotenv';
import { autoMailClient, autoMailConfiguration } from '../server-handlers/auto-mail/configuration.js';
import { connected, SEND_SCOPE, singleAddress } from '../server-handlers/auto-mail/gmail.js';
import { richRawReply } from '../server-handlers/auto-mail/mail-content.js';
import { deliverOutbox } from '../server-handlers/auto-mail/outbox.js';

dotenv.config({ path: '.env.local', quiet: true });
const args = process.argv.slice(2);
const recipient = args.includes('--to') ? args[args.indexOf('--to') + 1] : '';
const id = args.includes('--request-id') ? args[args.indexOf('--request-id') + 1] : '';
if (!recipient || !id || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id) || singleAddress(recipient) !== recipient) throw new Error('Use --to SINGLE_EMAIL --request-id UUID, and --send to send explicitly. Without --send this prints a preview only.');
const subject = 'CargoMove Auto Mail acceptance test';
const text = 'This is the requested Auto Mail delivery acceptance test. No action is required. This message was explicitly sent for verification; automatic AI replies remain controlled by the separate saved setting.\n\nCargoMove Support';
if (!args.includes('--send')) {
  console.log(JSON.stringify({ preview: true, to: recipient, subject, body: text, requestId: id }));
} else {
  try {
    const config = autoMailConfiguration(); if (!config.ready) throw new Error();
    const client = autoMailClient(config), connection = await connected(client);
    if (!connection.connected_by || !connection.scopes?.includes(SEND_SCOPE)) throw new Error();
    const existing = await client.from('outbox_messages').select('id,status').eq('id', id).maybeSingle();
    if (existing.error) throw new Error();
    if (existing.data) {
      // Even QUEUED/FAILED/UNCERTAIN requests are not retried by this command.
      console.log(JSON.stringify({ ...existing.data, reused: true, sentAgain: false }));
    } else {
      const html = '<p>' + text.replaceAll('\n', '<br>') + '</p>';
      const raw = Buffer.from(richRawReply(connection.email, { subject, messageId: '', references: '', compose: true }, { to: [recipient], cc: [], bcc: [] }, text, html, [], id), 'base64url');
      const path = `prepared/${connection.mailbox_id}/${id}.eml`;
      const stored = await client.storage.from('auto-mail-outbox').upload(path, raw, { contentType: 'application/octet-stream', upsert: false });
      if (stored.error) throw new Error();
      const inserted = await client.from('outbox_messages').insert({ id, actor_id: connection.connected_by, mailbox_id: connection.mailbox_id, connection_version: connection.version,
        subject, to_addresses: [recipient], cc_addresses: [], bcc_addresses: [], body_text: text, attachments: [], raw_path: path,
        raw_sha256: crypto.createHash('sha256').update(raw).digest('hex'), scheduled: false, send_at: new Date().toISOString() });
      if (inserted.error) throw new Error();
      const claim = await client.rpc('claim_outbox_message', { p_id: id });
      if (claim.error || !claim.data) throw new Error();
      console.log(JSON.stringify(await deliverOutbox(client, claim.data)));
    }
  } catch {
    console.error('Acceptance delivery could not be confirmed. Check Auto Mail Scheduled/history and Gmail Sent using this request ID. Do not retry with a new ID.');
    process.exitCode = 1;
  }
}
