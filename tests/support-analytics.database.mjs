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
    ),
    email = await readFile(
      "supabase/migrations/20260913000050_email_workflow.sql",
      "utf8",
    );
  await db.exec(
    `create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key,email text);grant usage on schema public to anon,authenticated,service_role;${baseline.match(/create or replace function public.touch_updated_at\(\)[\s\S]*?\$\$;/)[0]}${email.match(/create table if not exists public.gmail_connections \([\s\S]*?\n\);/)[0]}`,
  );
  for (const f of [
    "20260916000000_support_foundation.sql",
    "20260916000010_gmail_inbox_sync.sql",
    "20260916000030_support_ai_classification.sql",
    "20260916000040_support_knowledge.sql",
    "20260917000000_support_reply_drafts.sql",
    "20260917000010_support_reply_delivery.sql",
    "20260917000030_support_analytics.sql",
  ])
    await db.exec(await readFile(`supabase/migrations/${f}`, "utf8"));
  const rpc = async (from = null, to = null) =>
    (await db.query("select support_analytics($1,$2) result", [from, to]))
      .rows[0].result;
  let result = await rpc();
  eq(result.cases.total, 0);
  eq(result.response.average_seconds, null);
  eq(result.categories, []);
  eq(result.ai.classification_corrections, null);
  const admin = randomUUID(),
    c1 = randomUUID(),
    c2 = randomUUID(),
    c3 = randomUUID(),
    kb = randomUUID();
  await db.query("insert into auth.users values($1,'staff@example.com')", [
    admin,
  ]);
  await db.query(
    "insert into support_knowledge(id,knowledge_code,title,problem,resolution)values($1,'KB-HISTORICAL','Historical article','Issue','Guidance')",
    [kb],
  );
  await db.query(
    "insert into support_cases(id,customer_email,created_at,category,port,status,resolved_at)values($1,'one@example.com','2026-09-16T00:00:00Z','VEHICLE','WESTPORT','RESOLVED','2026-09-18T00:00:00Z'),($2,'two@example.com','2026-09-16T23:59:59Z','OTHER','UNKNOWN','ESCALATED',null),($3,'three@example.com','2026-09-17T00:00:00Z','OTHER','UNKNOWN','NEW',null)",
    [c1, c2, c3],
  );
  const msg = async (id, dir, time) =>
    db.query(
      "insert into support_messages(case_id,direction,sender_email,recipient_email,sent_at)values($1,$2,'one@example.com','support@example.com',$3) returning id",
      [id, dir, time],
    );
  const mid = (await msg(c1, "INBOUND", "2026-09-16T10:00:00Z")).rows[0].id;
  await msg(c1, "OUTBOUND", "2026-09-16T09:00:00Z");
  await msg(c1, "OUTBOUND", "2026-09-16T10:02:00Z");
  await msg(c1, "OUTBOUND", "2026-09-16T10:08:00Z");
  await msg(c1, "INBOUND", "2026-09-16T10:05:00Z");
  await msg(c2, "INBOUND", "2026-09-16T11:00:00Z");
  await db.query(
    "insert into support_case_events(case_id,action,from_status,to_status,reason,actor_id)values($1,'ESCALATE','NEW','ESCALATED','Review',$2),($1,'REOPEN','RESOLVED','NEW','More work',$2)",
    [c2, admin],
  );
  const analysis = randomUUID();
  await db.query(
    "insert into ai_interactions(id,case_id,model,prompt_version,confidence,analysis_key)values($1,$2,'fixture','v1',0.8,'analysis-key')",
    [analysis, c1],
  );
  async function draft(template, edited, delivered) {
    const a = randomUUID(),
      d = randomUUID();
    await db.query(
      "insert into ai_interactions(id,case_id,model,prompt_version,confidence,knowledge_ids,generated_reply,final_reply,was_edited,approved_by,approved_at)values($1,$2,'fixture','v1',0.8,$3,'Generated',$4,$5,$6,case when $6::uuid is null then null else clock_timestamp() end)",
      [
        a,
        c1,
        template === "KNOWLEDGE" ? [kb] : [],
        delivered ? (edited ? "Edited" : "Generated") : null,
        delivered ? edited : null,
        delivered ? admin : null,
      ],
    );
    await db.query(
      "insert into support_reply_drafts(id,case_id,source_analysis_id,interaction_id,generation_key,template_id,context_fingerprint,knowledge_versions,edited_reply,created_by,updated_by)values($1::uuid,$2,$3,$4,$1::text,$5,'context','{}','Generated',$6,$6)",
      [d, c1, analysis, a, template, admin],
    );
    const op = randomUUID(),
      opmid = (await msg(c1, "INBOUND", "2026-09-16T10:10:00Z")).rows[0].id;
    await db.query(
      "insert into support_reply_deliveries(id,case_id,draft_id,source_message_id,kind,status,operation_key,context_fingerprint,draft_version,mailbox_subject,mailbox_email,recipient_email,subject,reply_text,generated_reply,rfc_message_id,requested_by)values($1::uuid,$2,$3,$4,'SEND',$5,$1::text,$1::text,now(),'mailbox','support@example.com','one@example.com','Issue','Generated','Generated',$1::text,$6)",
      [op, c1, d, opmid, delivered ? "DONE" : "FAILED", admin],
    );
  }
  await draft("KNOWLEDGE", false, true);
  await draft("KNOWLEDGE", true, true);
  await draft("KNOWLEDGE", false, false);
  await draft("ACKNOWLEDGE", true, true);
  await db.exec("set role service_role");
  result = await rpc("2026-09-16T00:00:00Z", "2026-09-17T00:00:00Z");
  eq(result.cases.total, 2);
  eq(result.cases.resolved, 1);
  eq(result.cases.escalated, 1);
  eq(result.cases.escalation_events, 1);
  eq(result.cases.new, 0);
  eq(result.ai.classifications, 1);
  eq(result.ai.suggested_drafts, 4);
  eq(result.ai.knowledge_drafts, 3);
  eq(result.ai.static_drafts, 1);
  eq(result.ai.approved_unchanged, 1);
  eq(result.ai.approved_edited, 1);
  eq(result.ai.confirmed_sends, 3);
  eq(result.response.average_seconds, 120);
  eq(result.response.median_seconds, 120);
  eq(result.response.sample_cases, 1);
  eq(result.response.awaiting_first_response, 1);
  eq(result.response.without_inbound, 0);
  eq(result.daily_cases, [{ day: "2026-09-16", count: 2 }]);
  eq(result.knowledge_usage[0].drafts, 3);
  eq(result.knowledge_usage[0].sent_replies, 2);
  eq(result.knowledge_usage[0].active, false);
  result = await rpc();
  eq(result.cases.total, 3);
  eq(result.response.without_inbound, 1);
  eq((await rpc("2027-01-01T00:00:00Z")).response.average_seconds, null);
  process.env.VERCEL = "1";
  process.env.SESSION_SECRET = "fixture";
  process.env.SUPABASE_URL = "https://isolated-db.invalid";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "fixture";
  const { signSession } = await import("../api/_runtime.ts");
  const { default: handler } =
    await import("../server-handlers/support/analytics.ts");
  const cookie =
    "cargomove_session=" +
    signSession({
      id: admin,
      email: "staff@example.com",
      type: "ADMIN",
      exp: Date.now() + 60000,
    });
  const previous = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (input, init) => {
    calls++;
    const request = input instanceof Request ? input : new Request(input, init);
    eq(new URL(request.url).hostname, "isolated-db.invalid");
    const body = await request.json();
    return Response.json(await rpc(body.p_from, body.p_to));
  };
  async function run(query = {}, method = "GET", auth = true) {
    let status = 200,
      body;
    const response = {
      setHeader() {},
      status(n) {
        status = n;
        return this;
      },
      json(v) {
        body = v;
        return this;
      },
    };
    await handler(
      { method, query, headers: { cookie: auth ? cookie : "" } },
      response,
    );
    return { status, body };
  }
  try {
    eq((await run({}, "GET", false)).status, 401);
    eq(calls, 0);
    eq((await run({}, "POST")).status, 405);
    eq((await run({ from: "2026-09-17", to: "2026-09-16" })).status, 400);
    eq((await run({ from: "invalid" })).status, 400);
    eq(calls, 0);
    const api = await run({ from: "2026-09-16", to: "2026-09-16" });
    eq(api.status, 200);
    eq(api.body.cases.total, 2);
  } finally {
    globalThis.fetch = previous;
  }
  await db.exec("reset role");
  for (const role of ["anon", "authenticated"])
    eq(
      (
        await db.query(
          "select has_function_privilege($1,'support_analytics(timestamptz,timestamptz)','EXECUTE')ok",
          [role],
        )
      ).rows[0].ok,
      false,
    );
  console.log(`${checks} isolated analytics SQL/API checks passed.`);
} finally {
  await db.close();
}
