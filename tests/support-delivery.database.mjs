import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
const { PGlite } = await import(
  process.env.PGLITE_MODULE || "@electric-sql/pglite"
);
const db = new PGlite();
let checks = 0;
const eq = (a, b) => {
  assert.deepEqual(a, b);
  checks++;
};
try {
  const baseline = await readFile(
    "supabase/migrations/20260913000000_init.sql",
    "utf8",
  );
  const email = await readFile(
    "supabase/migrations/20260913000050_email_workflow.sql",
    "utf8",
  );
  await db.exec(
    `create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key,email text);grant usage on schema public to anon,authenticated,service_role;${baseline.match(/create or replace function public.touch_updated_at\(\)[\s\S]*?\$\$;/)[0]}${email.match(/create table if not exists public.gmail_connections \([\s\S]*?\n\);/)[0]}grant all on gmail_connections to service_role;`,
  );
  for (const f of [
    "20260916000000_support_foundation.sql",
    "20260916000010_gmail_inbox_sync.sql",
    "20260916000030_support_ai_classification.sql",
    "20260916000040_support_knowledge.sql",
    "20260917000000_support_reply_drafts.sql",
    "20260917000010_support_reply_delivery.sql",
  ])
    await db.exec(await readFile(`supabase/migrations/${f}`, "utf8"));
  const admin = randomUUID(),
    id = randomUUID();
  await db.query("insert into auth.users values($1,'staff@example.com')", [
    admin,
  ]);
  process.env.VERCEL = "1";
  process.env.SESSION_SECRET = "fixture";
  process.env.SUPABASE_URL = "https://isolated-db.invalid";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "fixture";
  process.env.GOOGLE_TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 3).toString(
    "base64",
  );
  process.env.GOOGLE_OAUTH_CLIENT_ID = "fixture";
  process.env.GOOGLE_OAUTH_CLIENT_SECRET = "fixture";
  process.env.APP_URL = "https://isolated.invalid";
  const { encryptRefreshToken } = await import("../server-handlers/_email.ts");
  const encrypted = encryptRefreshToken("fixture-refresh");
  const read = "https://www.googleapis.com/auth/gmail.readonly",
    send = "https://www.googleapis.com/auth/gmail.send",
    compose = "https://www.googleapis.com/auth/gmail.compose";
  await db.query(
    "insert into gmail_connections(google_subject,email,refresh_token_ciphertext,token_iv,token_auth_tag,scopes)values('mailbox','support@example.com',$1,$2,$3,$4)",
    [
      encrypted.refresh_token_ciphertext,
      encrypted.token_iv,
      encrypted.token_auth_tag,
      [read, send, compose],
    ],
  );
  await db.exec(
    "insert into gmail_sync_state(id,google_subject)values('system','mailbox')",
  );
  await db.query(
    "insert into support_cases(id,gmail_thread_id,customer_email,subject)values($1,'thread1','customer@example.com','Question')",
    [id],
  );
  await db.query(
    "insert into support_messages(case_id,gmail_message_id,gmail_thread_id,direction,sender_email,recipient_email,subject,body_text,sent_at)values($1,'inbound1','thread1','INBOUND','customer@example.com','support@example.com','Question','Please help',clock_timestamp())",
    [id],
  );
  await db.exec("set role service_role");
  const rpc = async (name, args) =>
    (
      await db.query(
        `select ${name}(${args.map((_, i) => "$" + (i + 1)).join(",")})result`,
        args,
      )
    ).rows[0].result;
  const analyze = async () => {
    const t = randomUUID();
    await rpc("claim_support_analysis", [id, "fixture", "v1", t, admin]);
    await rpc("complete_support_analysis", [
      id,
      t,
      {
        category: "OTHER",
        subcategory: null,
        port: "UNKNOWN",
        language: "EN",
        urgency: "NORMAL",
        confidence: 0.5,
        entities: {},
        short_explanation: "Review enquiry",
        recommended_action: "MANUAL_REVIEW",
      },
    ]);
  };
  const makeDraft = async () => {
    await analyze();
    const t = randomUUID();
    const claim = await rpc("claim_support_reply", [
      id,
      "ACKNOWLEDGE",
      "static",
      "v1",
      t,
      admin,
    ]);
    if (claim.cached_id)
      return (await rpc("get_support_reply", [id, claim.cached_id])).draft;
    const result = await rpc("complete_support_reply", [
      id,
      t,
      "Thank you for contacting us.",
      [],
    ]);
    return (await rpc("get_support_reply", [id, result.draft_id])).draft;
  };
  let draft = await makeDraft();
  draft = (
    await rpc("edit_support_reply", [
      draft.id,
      draft.updated_at,
      "Reviewed saved text.",
      admin,
    ])
  ).draft;
  const caseVersion = async () =>
    (await rpc("support_delivery_context", [id])).supportCase.updated_at;
  const claim = async (
    kind = "SEND",
    expected = draft.updated_at,
    mailbox = "mailbox",
  ) =>
    rpc("claim_support_delivery", [
      draft.id,
      expected,
      await caseVersion(),
      kind,
      randomUUID(),
      admin,
      mailbox,
      "support@example.com",
      "Question",
    ]);
  eq((await claim("SEND", "2000-01-01T00:00:00Z")).error, "CONFLICT");
  eq((await claim("SEND", draft.updated_at, "other")).error, "MAILBOX_CHANGED");
  let op = (await claim()).operation;
  eq(op.reply_text, "Reviewed saved text.");
  eq(op.requested_by, admin);
  eq((await claim()).cached, true);
  eq(
    (
      await rpc("edit_support_reply", [
        draft.id,
        draft.updated_at,
        "Race edit",
        admin,
      ])
    ).error,
    "PENDING",
  );
  eq(
    (
      await rpc("set_support_case_status", [
        id,
        await caseVersion(),
        "RESOLVE",
        "Done",
        admin,
      ])
    ).error,
    "PENDING",
  );
  await rpc("fail_support_delivery", [op.id, true]);
  eq((await claim()).operation.status, "UNKNOWN");
  eq(
    (
      await rpc("finish_support_delivery", [
        op.id,
        "out1",
        "wrong",
        null,
        new Date().toISOString(),
      ])
    ).error,
    "INVALID_RECEIPT",
  );
  eq(
    (
      await rpc("finish_support_delivery", [
        op.id,
        "out1",
        "thread1",
        null,
        new Date().toISOString(),
      ])
    ).status,
    "DONE",
  );
  eq(
    (
      await rpc("finish_support_delivery", [
        op.id,
        "out1",
        "thread1",
        null,
        new Date().toISOString(),
      ])
    ).status,
    "DONE",
  );
  eq(
    (
      await db.query(
        "select count(*)::int n from support_messages where direction='OUTBOUND'",
      )
    ).rows[0].n,
    1,
  );
  const audit = (
    await db.query(
      "select final_reply,was_edited,approved_by,approved_at from ai_interactions where id=$1",
      [draft.interaction_id],
    )
  ).rows[0];
  eq(audit.final_reply, op.reply_text);
  eq(audit.was_edited, true);
  eq(audit.approved_by, admin);
  assert.ok(audit.approved_at);
  checks++;
  eq(
    (await rpc("support_delivery_context", [id])).supportCase.status,
    "WAITING_CUSTOMER",
  );
  // Re-analysis and another template cannot send twice to the same inbound message.
  draft = await makeDraft();
  eq((await claim()).error, "ALREADY_SENT");
  await rpc("set_support_case_status", [
    id,
    await caseVersion(),
    "ESCALATE",
    "Requires port staff",
    admin,
  ]);
  eq(
    (await rpc("support_delivery_context", [id])).supportCase.status,
    "ESCALATED",
  );
  await rpc("set_support_case_status", [
    id,
    await caseVersion(),
    "RESOLVE",
    "Staff confirmed completion",
    admin,
  ]);
  eq(
    (await rpc("support_delivery_context", [id])).supportCase.status,
    "RESOLVED",
  );
  await rpc("set_support_case_status", [
    id,
    await caseVersion(),
    "REOPEN",
    "Further work required",
    admin,
  ]);
  eq((await rpc("support_delivery_state", [id])).events.length, 3);
  // New inbound message permits a new reviewed reply.
  await db.query(
    "insert into support_messages(case_id,gmail_message_id,gmail_thread_id,direction,sender_email,recipient_email,subject,body_text,sent_at)values($1,'inbound2','thread1','INBOUND','customer@example.com','support@example.com','Question','More help',clock_timestamp())",
    [id],
  );
  draft = await makeDraft();
  const { signSession } = await import("../api/_runtime.ts");
  const { deliveryWrite, deliveryReconcile, caseStatus } =
    await import("../server-handlers/support/delivery.ts");
  const cookie =
    "cargomove_session=" +
    signSession({
      id: admin,
      email: "staff@example.com",
      type: "ADMIN",
      exp: Date.now() + 600000,
    });
  const previousFetch = globalThis.fetch;
  let writes = 0,
    mode = "ok",
    lastRaw = "",
    lastBody,
    receiptRFC = "",
    receiptId = "";
  const meta = (mid, labels = ["INBOX"]) => ({
    id: mid,
    threadId: "thread1",
    internalDate: String(Date.now()),
    labelIds: labels,
    payload: {
      headers: [
        { name: "From", value: "Customer <customer@example.com>" },
        { name: "To", value: "support@example.com" },
        { name: "Subject", value: "Question" },
        { name: "Message-ID", value: `<${mid}@example.com>` },
      ],
    },
  });
  const signatures = {
    support_delivery_state: ["p_case"],
    get_support_reply: ["p_case", "p_draft"],
    support_delivery_context: ["p_case"],
    claim_support_delivery: [
      "p_draft",
      "p_expected",
      "p_case_version",
      "p_kind",
      "p_id",
      "p_admin",
      "p_mailbox",
      "p_email",
      "p_subject",
    ],
    finish_support_delivery: [
      "p_id",
      "p_message",
      "p_thread",
      "p_draft",
      "p_sent_at",
    ],
    fail_support_delivery: ["p_id", "p_uncertain"],
    set_support_case_status: [
      "p_id",
      "p_expected",
      "p_action",
      "p_reason",
      "p_admin",
    ],
  };
  globalThis.fetch = async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init),
      url = new URL(request.url);
    if (url.hostname === "isolated-db.invalid") {
      if (url.pathname.endsWith("/gmail_connections"))
        return Response.json(
          (await db.query("select * from gmail_connections")).rows[0],
        );
      const fn = url.pathname.split("/").pop(),
        body = await request.json();
      assert.ok(signatures[fn]);
      try {
        return Response.json(
          await rpc(
            fn,
            signatures[fn].map((k) => body[k]),
          ),
        );
      } catch (e) {
        return Response.json({ message: e.message }, { status: 400 });
      }
    }
    if (url.hostname === "oauth2.googleapis.com")
      return Response.json({ access_token: "fixture-token" });
    eq(url.hostname, "gmail.googleapis.com");
    if (request.method !== "GET") {
      writes++;
      lastBody = await request.json();
      lastRaw = Buffer.from(
        lastBody.raw || lastBody.message.raw,
        "base64url",
      ).toString();
      receiptRFC = lastRaw.match(/Message-ID: (.+)\r/)[1];
      receiptId = "out" + writes;
      if (mode === "timeout")
        throw new Error("network lost after accepted write");
      if (mode === "reject")
        return Response.json({ error: "rejected" }, { status: 403 });
      if (
        url.pathname.endsWith("/drafts") ||
        /\/drafts\/draft1$/.test(url.pathname)
      )
        return Response.json({
          id: "draft1",
          message: { id: "draftmessage" + writes, threadId: "thread1" },
        });
      return Response.json({ id: receiptId, threadId: "thread1" });
    }
    if (url.pathname.endsWith("/profile"))
      return Response.json({ emailAddress: "support@example.com" });
    if (url.pathname.endsWith("/threads/thread1")) {
      const messages = (
        await db.query(
          "select gmail_message_id,direction from support_messages where case_id=$1 order by sent_at,id",
          [id],
        )
      ).rows.map((m) =>
        meta(
          m.gmail_message_id,
          m.direction === "OUTBOUND" ? ["SENT"] : ["INBOX"],
        ),
      );
      if (mode === "new-message") messages.push(meta("not-imported"));
      if (mode === "wrong-recipient")
        messages.find((m) => m.id === "inbound2").payload.headers[0].value =
          "other@example.com";
      return Response.json({ id: "thread1", messages });
    }
    if (url.pathname.endsWith("/messages"))
      return Response.json({
        messages: mode === "not-found" ? [] : [{ id: receiptId }],
      });
    if (url.pathname.endsWith("/messages/" + receiptId))
      return Response.json({
        ...meta(receiptId, ["SENT"]),
        payload: {
          headers: [
            { name: "From", value: "support@example.com" },
            { name: "To", value: "customer@example.com" },
            { name: "Message-ID", value: receiptRFC },
          ],
        },
      });
    throw new Error("Unexpected mocked URL " + url);
  };
  async function run(handler, body, authenticated = true) {
    let status = 200,
      result;
    const response = {
      setHeader() {},
      status(n) {
        status = n;
        return this;
      },
      json(v) {
        result = v;
        return this;
      },
    };
    await handler(
      {
        method: "POST",
        body,
        query: {},
        headers: { cookie: authenticated ? cookie : "" },
      },
      response,
    );
    return { status, result };
  }
  const payload = (kind = "SEND") => ({
    case_id: id,
    draft_id: draft.id,
    updated_at: draft.updated_at,
    kind,
    reviewed: true,
  });
  try {
    eq((await run(deliveryWrite, payload(), false)).status, 401);
    eq(
      (await run(deliveryWrite, { ...payload(), reviewed: false })).status,
      400,
    );
    eq(writes, 0);
    mode = "new-message";
    eq((await run(deliveryWrite, payload())).result.code, "SYNC_REQUIRED");
    eq(writes, 0);
    mode = "wrong-recipient";
    eq((await run(deliveryWrite, payload())).result.code, "INVALID_RECIPIENT");
    eq(writes, 0);
    await db.query("update gmail_connections set scopes=$1", [[read, send]]);
    mode = "ok";
    eq(
      (await run(deliveryWrite, payload("GMAIL_DRAFT"))).result.code,
      "COMPOSE_PERMISSION_REQUIRED",
    );
    eq(writes, 0);
    await db.query("update gmail_connections set scopes=$1", [
      [read, send, compose],
    ]);
    let outcome = await run(deliveryWrite, payload("GMAIL_DRAFT"));
    eq(outcome.status, 200);
    eq(writes, 1);
    assert.ok(lastRaw.includes("In-Reply-To: <inbound2@example.com>"));
    assert.ok(!lastRaw.includes("Bcc:"));
    checks += 2;
    eq((await run(deliveryWrite, payload("GMAIL_DRAFT"))).status, 200);
    eq(writes, 1);
    draft = (
      await rpc("edit_support_reply", [
        draft.id,
        draft.updated_at,
        "Exact approved replacement text.",
        admin,
      ])
    ).draft;
    mode = "timeout";
    outcome = await run(deliveryWrite, payload());
    eq(outcome.result.code, "DELIVERY_UNKNOWN");
    eq(lastBody.id, "draft1");
    eq(
      Buffer.from(
        lastRaw.split("\r\n\r\n")[1].replace(/\s/g, ""),
        "base64",
      ).toString(),
      "Exact approved replacement text.",
    );
    const uncertain = (
      await rpc("support_delivery_state", [id])
    ).deliveries.find((d) => d.status === "UNKNOWN");
    assert.ok(uncertain);
    checks++;
    eq((await run(deliveryWrite, payload())).result.code, "PENDING");
    eq(writes, 2);
    eq(
      (
        await run(caseStatus, {
          case_id: id,
          updated_at: await caseVersion(),
          action: "RESOLVE",
          reason: "Done",
        })
      ).result.code,
      "PENDING",
    );
    eq(
      (
        await run(deliveryReconcile, {
          case_id: id,
          operation_id: uncertain.id,
        })
      ).result.code,
      "PENDING",
    );
    const originalNow = Date.now;
    Date.now = () => originalNow() + 60000;
    mode = "not-found";
    eq(
      (
        await run(deliveryReconcile, {
          case_id: id,
          operation_id: uncertain.id,
        })
      ).result.code,
      "DELIVERY_UNKNOWN",
    );
    eq(writes, 2);
    mode = "ok";
    outcome = await run(deliveryReconcile, {
      case_id: id,
      operation_id: uncertain.id,
    });
    eq(outcome.status, 200);
    eq(outcome.result.operation.status, "DONE");
    eq(writes, 2);
    Date.now = originalNow;
    eq((await run(deliveryWrite, payload())).status, 200);
    eq(writes, 2);
    eq(
      (
        await db.query(
          "select body_text from support_messages where gmail_message_id=$1",
          [receiptId],
        )
      ).rows[0].body_text,
      "Exact approved replacement text.",
    );
    await db.query(
      "insert into support_messages(case_id,gmail_message_id,gmail_thread_id,direction,sender_email,recipient_email,subject,body_text,sent_at)values($1,'inbound3','thread1','INBOUND','customer@example.com','support@example.com','Question','Follow up',clock_timestamp())",
      [id],
    );
    draft = await makeDraft();
    await db.query("update gmail_connections set scopes=$1", [[read, send]]);
    mode = "reject";
    eq(
      (await run(deliveryWrite, payload())).result.code,
      "GMAIL_WRITE_REJECTED",
    );
    eq(writes, 3);
    eq(
      (await rpc("support_delivery_state", [id])).deliveries.filter(
        (d) => d.status === "FAILED",
      ).length,
      1,
    );
    mode = "ok";
    eq((await run(deliveryWrite, payload())).status, 200);
    eq(writes, 4);
    eq(lastBody.id, undefined);
    eq(lastBody.threadId, "thread1");
    eq(
      (
        await db.query("select was_edited from ai_interactions where id=$1", [
          draft.interaction_id,
        ])
      ).rows[0].was_edited,
      false,
    );
  } finally {
    globalThis.fetch = previousFetch;
  }
  await db.exec("reset role");
  for (const role of ["anon", "authenticated"]) {
    for (const table of ["support_reply_deliveries", "support_case_events"])
      eq(
        (
          await db.query("select has_table_privilege($1,$2,'SELECT')ok", [
            role,
            table,
          ])
        ).rows[0].ok,
        false,
      );
    for (const fn of [
      "support_delivery_state(uuid)",
      "support_delivery_context(uuid)",
      "claim_support_delivery(uuid,timestamptz,timestamptz,text,uuid,uuid,text,text,text)",
      "finish_support_delivery(uuid,text,text,text,timestamptz)",
      "fail_support_delivery(uuid,boolean)",
      "set_support_case_status(uuid,timestamptz,text,text,uuid)",
    ])
      eq(
        (
          await db.query("select has_function_privilege($1,$2,'EXECUTE')ok", [
            role,
            fn,
          ])
        ).rows[0].ok,
        false,
      );
  }
  console.log(`${checks} isolated delivery database/API checks passed.`);
} finally {
  await db.close();
}
