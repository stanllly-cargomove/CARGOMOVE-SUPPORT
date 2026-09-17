import { InboxError, validGmailId, type GmailReader } from "../gmail/client.js";
export interface MetadataMessage {
  id: string;
  threadId: string;
  internalDate?: string;
  labelIds?: string[];
  payload?: { headers?: Array<{ name: string; value: string }> };
}
export function header(message: MetadataMessage, name: string): string {
  const matches = (message.payload?.headers || []).filter(
    (h) => h.name.toLowerCase() === name.toLowerCase(),
  );
  if (matches.length > 1)
    throw new InboxError(
      "INVALID_HEADERS",
      "Gmail returned ambiguous reply headers.",
      409,
    );
  const value = matches[0]?.value || "";
  if (/[\r\n\x00]/.test(value))
    throw new InboxError("INVALID_HEADERS", "Unsafe reply header.", 409);
  return value;
}
export function mailbox(value: string): string {
  const match = value.match(/^(?:[^<>]*<([^<>]+)>|([^<>\s,;]+@[^<>\s,;]+))$/);
  const email = (match?.[1] || match?.[2] || "").trim().toLowerCase();
  if (!/^[^\s@<>(),;:]+@[^\s@<>(),;:]+\.[^\s@<>(),;:]+$/.test(email))
    throw new InboxError(
      "INVALID_RECIPIENT",
      "A single valid mailbox is required.",
      409,
    );
  return email;
}
function messageId(value: string): string {
  if (value.length > 254 || !/^<[^<>\s@]+@[^<>\s@]+>$/.test(value))
    throw new InboxError(
      "INVALID_HEADERS",
      "The original email has no safe Message-ID for threading.",
      409,
    );
  return value;
}
function encodedSubject(subject: string): string {
  const chunks: string[] = [];
  let chunk = "";
  for (const character of subject) {
    if (Buffer.byteLength(chunk + character) > 42) {
      chunks.push(chunk);
      chunk = "";
    }
    chunk += character;
  }
  if (chunk) chunks.push(chunk);
  return chunks
    .map((value) => `=?UTF-8?B?${Buffer.from(value).toString("base64")}?=`)
    .join("\r\n ");
}
export function rawReply(
  from: string,
  to: string,
  subject: string,
  text: string,
  id: string,
  parent: MetadataMessage,
): string {
  mailbox(from);
  mailbox(to);
  messageId(id);
  const parentId = messageId(header(parent, "Message-ID"));
  const references = header(parent, "References").trim();
  if (references && !/^(?:<[^<>\s@]+@[^<>\s@]+>\s*)+$/.test(references))
    throw new InboxError("INVALID_HEADERS", "Unsafe thread references.", 409);
  if (!subject || /[\r\n\x00]/.test(subject))
    throw new InboxError("INVALID_HEADERS", "Unsafe reply subject.", 409);
  const lines = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${encodedSubject(subject)}`,
    `Message-ID: ${id}`,
    `In-Reply-To: ${parentId}`,
    `References: ${(references + " " + parentId).trim().split(/\s+/).map(messageId).join("\r\n ")}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from(text)
      .toString("base64")
      .match(/.{1,76}/g)
      ?.join("\r\n") || "",
  ];
  return Buffer.from(lines.join("\r\n")).toString("base64url");
}
export async function preflight(
  reader: GmailReader,
  threadId: string,
  inboundId: string,
  known: string[],
  customer: string,
  sender: string,
): Promise<MetadataMessage> {
  const profile = await reader.get<{ emailAddress: string }>("profile");
  if (mailbox(profile.emailAddress) !== mailbox(sender))
    throw new InboxError(
      "MAILBOX_CHANGED",
      "The connected Gmail mailbox changed. Reconnect and sync.",
      409,
    );
  const thread = await reader.get<{ id: string; messages?: MetadataMessage[] }>(
    `threads/${validGmailId(threadId)}`,
    new URLSearchParams({ format: "metadata" }),
  );
  if (
    thread.id !== threadId ||
    !thread.messages?.length ||
    thread.messages.some(
      (m) => !m.labelIds?.includes("DRAFT") && !known.includes(m.id),
    )
  )
    throw new InboxError(
      "SYNC_REQUIRED",
      "The Gmail conversation changed. Refresh cases before replying.",
      409,
    );
  const parent = thread.messages.find(
    (m) =>
      m.id === inboundId &&
      !m.labelIds?.includes("DRAFT") &&
      !m.labelIds?.includes("SENT"),
  );
  if (
    !parent ||
    parent.threadId !== threadId ||
    mailbox(header(parent, "From")) !== mailbox(customer)
  )
    throw new InboxError(
      "INVALID_RECIPIENT",
      "The customer and original Gmail sender do not match.",
      409,
    );
  const replyTo = header(parent, "Reply-To");
  if (replyTo && mailbox(replyTo) !== mailbox(customer))
    throw new InboxError(
      "INVALID_RECIPIENT",
      "The original Reply-To differs from the customer. Review this conversation manually.",
      409,
    );
  messageId(header(parent, "Message-ID"));
  return parent;
}
export class WriteError extends InboxError {
  constructor(readonly uncertain: boolean) {
    super(
      uncertain ? "DELIVERY_UNKNOWN" : "GMAIL_WRITE_REJECTED",
      uncertain
        ? "Gmail may have accepted this action. Check Gmail result before any further reply."
        : "Gmail rejected this action. Check authorization and refresh before retrying.",
      409,
    );
  }
}
export async function gmailWrite(
  accessToken: string,
  path: string,
  method: string,
  body: unknown,
): Promise<{ id: string; threadId?: string; message?: MetadataMessage }> {
  let response: Response;
  try {
    response = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/${path}`,
      {
        method,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10000),
      },
    );
  } catch {
    throw new WriteError(true);
  }
  if (!response.ok)
    throw new WriteError(![400, 401, 403, 404].includes(response.status));
  try {
    return await response.json();
  } catch {
    throw new WriteError(true);
  }
}
