import crypto from 'node:crypto';

function key() {
  const configured = process.env.AUTO_MAIL_TOKEN_ENCRYPTION_KEY || process.env.GOOGLE_TOKEN_ENCRYPTION_KEY;
  const decoded = Buffer.from(configured || '', 'base64');
  if (decoded.length !== 32) throw new Error('Configure a base64-encoded 32-byte Auto Mail token encryption key.');
  return decoded;
}

export function encryptMailboxToken(token: string) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const encrypted = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  return { refresh_token_ciphertext: encrypted.toString('base64'), token_iv: iv.toString('base64'), token_auth_tag: cipher.getAuthTag().toString('base64') };
}

export function decryptMailboxToken(connection: any) {
  const decipher = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(connection.token_iv, 'base64'));
  decipher.setAuthTag(Buffer.from(connection.token_auth_tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(connection.refresh_token_ciphertext, 'base64')), decipher.final()]).toString('utf8');
}
