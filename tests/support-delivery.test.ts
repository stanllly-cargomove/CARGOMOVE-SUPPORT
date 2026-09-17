import test from "node:test";
import assert from "node:assert/strict";
import {
  mailbox,
  rawReply,
  preflight,
  type MetadataMessage,
} from "../server-handlers/support/delivery-gmail.js";
const parent: MetadataMessage = {
  id: "inbound1",
  threadId: "thread1",
  labelIds: ["INBOX"],
  payload: {
    headers: [
      { name: "From", value: "Customer <customer@example.com>" },
      { name: "Subject", value: "Pertanyaan kenderaan" },
      { name: "Message-ID", value: "<parent@example.com>" },
      { name: "References", value: "<earlier@example.com>" },
    ],
  },
};
test("reply MIME preserves exact reviewed UTF-8 plain text and thread headers", () => {
  const text = "Terima kasih.\nSila semak nombor rujukan. <not HTML>";
  const raw = Buffer.from(
    rawReply(
      "support@example.com",
      "customer@example.com",
      "Pertanyaan kenderaan",
      text,
      "<reply@cargomove.support>",
      parent,
    ),
    "base64url",
  ).toString();
  assert.ok(raw.includes("In-Reply-To: <parent@example.com>\r\n"));
  assert.ok(
    raw.includes("References: <earlier@example.com>\r\n <parent@example.com>"),
  );
  assert.equal(
    Buffer.from(
      raw.split("\r\n\r\n")[1].replace(/\s/g, ""),
      "base64",
    ).toString(),
    text,
  );
  assert.ok(!raw.includes("Bcc:"));
});
test("reject recipient lists and header injection", () => {
  assert.throws(() => mailbox("one@example.com,two@example.com"));
  assert.throws(() =>
    rawReply(
      "support@example.com",
      "customer@example.com",
      "Question\r\nBcc: attacker@example.com",
      "text",
      "<reply@cargomove.support>",
      parent,
    ),
  );
  assert.throws(() =>
    rawReply(
      "support@example.com",
      "customer@example.com",
      "Question",
      "text",
      "<reply@cargomove.support>",
      {
        ...parent,
        payload: {
          headers: [
            ...parent.payload!.headers!,
            { name: "Message-ID", value: "<other@example.com>" },
          ],
        },
      },
    ),
  );
});
test("preflight rejects changed Reply-To and ignores unsent Gmail drafts", async () => {
  const get = async <T>(path: string): Promise<T> =>
    (path === "profile"
      ? { emailAddress: "support@example.com" }
      : {
          id: "thread1",
          messages: [
            parent,
            { id: "draft1", threadId: "thread1", labelIds: ["DRAFT"] },
          ],
        }) as T;
  assert.equal(
    (
      await preflight(
        { get },
        "thread1",
        "inbound1",
        ["inbound1"],
        "customer@example.com",
        "support@example.com",
      )
    ).id,
    "inbound1",
  );
  const changed = {
    ...parent,
    payload: {
      headers: [
        ...parent.payload!.headers!,
        { name: "Reply-To", value: "attacker@example.com" },
      ],
    },
  };
  const getChanged = async <T>(path: string): Promise<T> =>
    (path === "profile"
      ? { emailAddress: "support@example.com" }
      : { id: "thread1", messages: [changed] }) as T;
  await assert.rejects(
    preflight(
      { get: getChanged },
      "thread1",
      "inbound1",
      ["inbound1"],
      "customer@example.com",
      "support@example.com",
    ),
  );
});

test("long UTF-8 subjects use bounded encoded words without splitting characters", () => {
  const subject = "Pertanyaan 🚚 ".repeat(30);
  const raw = Buffer.from(
    rawReply(
      "support@example.com",
      "customer@example.com",
      subject,
      "text",
      "<reply@cargomove.support>",
      parent,
    ),
    "base64url",
  ).toString();
  const words = raw.match(/=\?UTF-8\?B\?([^?]+)\?=/g)!;
  assert.ok(words.every((word) => word.length <= 75));
  assert.equal(
    words
      .map((word) => Buffer.from(word.slice(10, -2), "base64").toString())
      .join(""),
    subject,
  );
});
