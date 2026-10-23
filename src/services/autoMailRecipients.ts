import emailAddresses from 'email-addresses';

export type MailRecipient = { name: string; email: string };
export function parseMailRecipients(value: string): MailRecipient[] {
  if (!value.trim()) return [];
  const parsed = emailAddresses.parseAddressList({input:value, rfc6532:true});
  if (!parsed) return [{name:'',email:value.trim()}];
  return parsed.flatMap(item => item.type === 'group' ? item.addresses : [item]).map(item => ({name:item.name || '',email:item.address}));
}
