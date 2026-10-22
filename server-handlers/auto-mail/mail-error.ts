export class MailError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
