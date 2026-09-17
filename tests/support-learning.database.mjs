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
    "20260917000020_support_learning.sql",
  ])
    await db.exec(await readFile(`supabase/migrations/${f}`, "utf8"));
  const admin = randomUUID();
  await db.query("insert into auth.users values($1,'staff@example.com')", [
    admin,
  ]);
  const rpc = async (name, args = []) =>
    (
      await db.query(
        `select ${name}(${args.map((_, i) => "$" + (i + 1)).join(",")})result`,
        args,
      )
    ).rows[0].result;
  const article = {
    knowledge_code: "KB-ORIGINAL",
    title: "Guidance",
    category: "OTHER",
    subcategory: null,
    port: "ALL",
    problem: "Common issue",
    possible_cause: null,
    resolution: "Old guidance",
    suggested_action: null,
    keywords: [],
    requires_port_verification: false,
    human_review_required: true,
    ai_reply_allowed: false,
    active: false,
  };
  const knowledge = await rpc("save_support_knowledge", [
    null,
    null,
    article,
    admin,
  ]);
  async function evidence(
    final,
    source = null,
    status = "DONE",
    caseId = randomUUID(),
    generated = "Generated guidance",
    approved = true,
  ) {
    await db.query(
      "insert into support_cases(id,customer_email)values($1,'customer@example.com') on conflict do nothing",
      [caseId],
    );
    const mid = (
      await db.query(
        "insert into support_messages(case_id,direction,sender_email,recipient_email,sent_at)values($1,'INBOUND','customer@example.com','support@example.com',now())returning id",
        [caseId],
      )
    ).rows[0].id;
    const interaction = randomUUID();
    await db.query(
      "insert into ai_interactions(id,case_id,model,prompt_version,confidence,knowledge_ids,generated_reply,final_reply,was_edited,approved_by,approved_at)values($1,$2,'fixture','v1',0.8,$3,$4,$5,$6,$7,case when $7::uuid is null then null else clock_timestamp() end)",
      [
        interaction,
        caseId,
        source ? [source] : [],
        generated,
        final,
        generated !== final,
        approved ? admin : null,
      ],
    );
    const did = randomUUID();
    await db.query(
      "insert into support_reply_drafts(id,case_id,source_analysis_id,interaction_id,generation_key,template_id,context_fingerprint,knowledge_versions,edited_reply,created_by,updated_by)values($1::uuid,$2,$3,$3,$1::text,'ACKNOWLEDGE','context','{}',$4,$5,$5)",
      [did, caseId, interaction, final, admin],
    );
    const op = randomUUID();
    await db.query(
      "insert into support_reply_deliveries(id,case_id,draft_id,source_message_id,kind,status,operation_key,context_fingerprint,draft_version,mailbox_subject,mailbox_email,recipient_email,subject,reply_text,generated_reply,rfc_message_id,requested_by)values($1::uuid,$2,$3,$4,'SEND',$5,$1::text,$1::text,now(),'mailbox','support@example.com','customer@example.com','Issue',$6,$7,$1::text,$8)",
      [op, caseId, did, mid, status, final, generated, admin],
    );
    return caseId;
  }
  await db.exec("set role service_role");
  const cid = await evidence("Staff corrected guidance.");
  await evidence(" Staff corrected   guidance. ");
  await evidence("Staff corrected guidance.", null, "DONE", cid);
  eq((await rpc("detect_support_learning")).created, 0);
  await evidence("Staff corrected guidance.");
  eq((await rpc("detect_support_learning")).created, 1);
  eq((await rpc("detect_support_learning")).created, 0);
  let list = await rpc("list_support_learning", ["PENDING", 0]),
    s = list.suggestions[0];
  eq(s.evidence_count, 3);
  let detail = await rpc("get_support_learning", [s.id]);
  eq(detail.evidence.length, 3);
  eq(detail.knowledge, null);
  eq(detail.evidence[0].approved_by, admin);
  await evidence("Staff corrected guidance.");
  await rpc("detect_support_learning");
  eq(
    (
      await rpc("review_support_learning", [
        s.id,
        s.updated_at,
        false,
        null,
        admin,
      ])
    ).error,
    "CONFLICT",
  );
  s = (await rpc("get_support_learning", [s.id])).suggestion;
  eq(s.evidence_count, 4);
  let reviewed = await rpc("review_support_learning", [
    s.id,
    s.updated_at,
    true,
    {
      ...article,
      knowledge_code: "KB-LEARNED",
      resolution: "Human generalized procedure.",
    },
    admin,
  ]);
  eq(reviewed.suggestion.status, "APPROVED");
  eq(reviewed.article.active, false);
  eq(
    reviewed.suggestion.approved_article.resolution,
    "Human generalized procedure.",
  );
  eq(reviewed.article.ai_reply_allowed, false);
  eq(reviewed.article.updated_by, admin);
  eq(reviewed.suggestion.approved_knowledge_id, reviewed.article.id);
  eq(
    (
      await rpc("review_support_learning", [
        s.id,
        s.updated_at,
        false,
        null,
        admin,
      ])
    ).error,
    "CONFLICT",
  );
  await evidence("Staff corrected guidance.");
  await rpc("detect_support_learning");
  eq((await rpc("get_support_learning", [s.id])).suggestion.evidence_count, 4);
  for (let i = 0; i < 3; i++)
    await evidence("Second correction.", knowledge.id);
  eq((await rpc("detect_support_learning")).created, 1);
  s = (await rpc("list_support_learning", ["PENDING", 0])).suggestions[0];
  eq(s.existing_knowledge_id, knowledge.id);
  const updated = await rpc("save_support_knowledge", [
    knowledge.id,
    knowledge.updated_at,
    { ...article, resolution: "Concurrent update" },
    admin,
  ]);
  eq(
    (
      await rpc("review_support_learning", [
        s.id,
        s.updated_at,
        true,
        { ...article, resolution: "Proposal" },
        admin,
      ])
    ).error,
    "CONFLICT",
  );
  eq((await rpc("get_support_learning", [s.id])).suggestion.status, "PENDING");
  reviewed = await rpc("review_support_learning", [
    s.id,
    s.updated_at,
    false,
    null,
    admin,
  ]);
  eq(reviewed.suggestion.status, "REJECTED");
  eq(reviewed.suggestion.reviewed_by, admin);
  eq((await rpc("detect_support_learning")).created, 0);
  eq(
    (
      await db.query("select resolution from support_knowledge where id=$1", [
        knowledge.id,
      ])
    ).rows[0].resolution,
    "Concurrent update",
  );
  // Unsent, unapproved and normalized formatting-only changes never contribute.
  for (let i = 0; i < 3; i++) {
    await evidence("Unsure correction", null, "UNKNOWN");
    await evidence(
      "Unapproved correction",
      null,
      "DONE",
      randomUUID(),
      "Generated guidance",
      false,
    );
    await evidence(
      "same   wording",
      null,
      "DONE",
      randomUUID(),
      " Same wording ",
    );
  }
  eq((await rpc("detect_support_learning")).created, 0);
  for (let i = 0; i < 3; i++) await evidence("Third correction.", knowledge.id);
  await rpc("detect_support_learning");
  const third = (await rpc("list_support_learning", ["PENDING", 0]))
    .suggestions[0];
  eq(
    (
      await rpc("review_support_learning", [
        third.id,
        third.updated_at,
        true,
        {
          ...article,
          knowledge_code: "KB-LEARNED",
          resolution: "Human approved update",
        },
        admin,
      ])
    ).error,
    "DUPLICATE_CODE",
  );
  eq(
    (await rpc("get_support_learning", [third.id])).suggestion.status,
    "PENDING",
  );
  const updatedReview = await rpc("review_support_learning", [
    third.id,
    third.updated_at,
    true,
    { ...article, resolution: "Human approved update" },
    admin,
  ]);
  eq(updatedReview.article.id, knowledge.id);
  eq(updatedReview.article.resolution, "Human approved update");
  eq(updatedReview.suggestion.status, "APPROVED");
  process.env.VERCEL = "1";
  process.env.SESSION_SECRET = "fixture";
  process.env.SUPABASE_URL = "https://isolated-db.invalid";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "fixture";
  const { signSession } = await import("../api/_runtime.ts");
  const { learningWrite } =
    await import("../server-handlers/support/learning.ts");
  const cookie =
    "cargomove_session=" +
    signSession({
      id: admin,
      email: "staff@example.com",
      type: "ADMIN",
      exp: Date.now() + 60000,
    });
  const previous = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const req = input instanceof Request ? input : new Request(input, init),
      url = new URL(req.url);
    eq(url.hostname, "isolated-db.invalid");
    const body = await req.json(),
      fn = url.pathname.split("/").pop();
    const sig = {
      detect_support_learning: [],
      review_support_learning: [
        "p_id",
        "p_expected",
        "p_approve",
        "p_article",
        "p_admin",
      ],
    }[fn];
    return Response.json(
      await rpc(
        fn,
        sig.map((k) => body[k]),
      ),
    );
  };
  async function run(body, auth = true) {
    let status = 200,
      result;
    const res = {
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
    await learningWrite(
      {
        method: "POST",
        body,
        query: {},
        headers: { cookie: auth ? cookie : "" },
      },
      res,
    );
    return { status, result };
  }
  try {
    eq((await run({ action: "DETECT" }, false)).status, 401);
    eq((await run({ action: "DETECT" })).status, 200);
    eq(
      (
        await run({
          action: "APPROVE",
          id: s.id,
          updated_at: s.updated_at,
          article: {
            ...article,
            human_review_required: false,
            requires_port_verification: true,
          },
        })
      ).status,
      400,
    );
    eq(
      (await run({ action: "REJECT", id: s.id, updated_at: s.updated_at }))
        .status,
      409,
    );
  } finally {
    globalThis.fetch = previous;
  }
  await db.exec("reset role");
  for (const role of ["anon", "authenticated"]) {
    eq(
      (
        await db.query(
          "select has_table_privilege($1,'support_learning_evidence','SELECT')ok",
          [role],
        )
      ).rows[0].ok,
      false,
    );
    for (const fn of [
      "detect_support_learning()",
      "list_support_learning(text,integer)",
      "get_support_learning(uuid)",
      "review_support_learning(uuid,timestamptz,boolean,jsonb,uuid)",
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
  console.log(`${checks} isolated learning SQL/API checks passed.`);
} finally {
  await db.close();
}
