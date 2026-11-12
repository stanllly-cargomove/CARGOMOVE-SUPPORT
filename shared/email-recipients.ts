const EMAIL_ADDRESS = /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i;

/** Bare email addresses only; shared by the preview and its send endpoint. */
export function normalizeEmailRecipients(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error('Enter at least one recipient email address.');
  // Check before trimming/splitting so a pasted header cannot become a recipient.
  if (/[\x00-\x1f\x7f]/.test(value)) throw new Error('Enter email addresses separated by commas or semicolons.');
  const addresses = value.split(/[,;]/).map((address) => address.trim().toLowerCase());
  if (addresses.some((address) => !EMAIL_ADDRESS.test(address) || address.length > 254 || address.split('@')[0].length > 64)) {
    throw new Error('Enter valid email addresses separated by commas or semicolons.');
  }
  const recipients = [...new Set(addresses)].join(', ');
  // Keep the unfolded To header within the MIME line length limit.
  if (recipients.length > 994) throw new Error('The recipient list is too long. Remove some addresses.');
  return recipients;
}
