import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
const { PGlite } = await import(
  process.env.PGLITE_MODULE || '@electric-sql/pglite'
);
const db = new PGlite();
let checks = 0;
try {
  const baseline = await readFile(
    'supabase/migrations/20260913000000_init.sql',
    'utf8',
  );
  await db.exec(
    `create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key,email text);grant usage on schema public to anon,authenticated,service_role;${baseline.match(/create or replace function public.touch_updated_at\(\)[\s\S]*?\$\$;/)[0]}`,
  );
  for (const file of [
    '20260916000000_support_foundation.sql',
    '20260916000030_support_ai_classification.sql',
    '20260916000040_support_knowledge.sql',
    '20260917000000_support_reply_drafts.sql',
  ])
    await db.exec(await readFile(`supabase/migrations/${file}`, 'utf8'));
  const admin = randomUUID(),
    id = randomUUID();
  await db.query('insert into auth.users values($1,$2)', [
    admin,
    'staff@example.com',
  ]);
  await db.query(
    "insert into support_cases(id,customer_email,subject)values($1,'customer@example.com','Vehicle XYZ123 at Westport')",
    [id],
  );
  const addMessage = async (text) =>
    db.query(
      "insert into support_messages(case_id,direction,sender_email,recipient_email,body_text,sent_at)values($1,'INBOUND','customer@example.com','staff@example.com',$2,clock_timestamp())",
      [id, text],
    );
  await addMessage(
    'Vehicle XYZ123 unavailable at Westport. password: fixture private secret',
  );
  await db.exec('set role service_role');
  const rpc = async (name, args) =>
    (
      await db.query(
        `select ${name}(${args.map((_, i) => '$' + (i + 1)).join(',')})result`,
        args,
      )
    ).rows[0].result;
  const claim = (token, template = 'KNOWLEDGE', model = 'fixture-model') =>
    rpc('claim_support_reply', [
      id,
      template,
      model,
      'support-reply-v1',
      token,
      admin,
    ]);
  assert.equal((await claim(randomUUID())).error, 'NO_ANALYSIS');
  checks++;
  const classification = {
    category: 'VEHICLE',
    subcategory: 'VEHICLE_NOT_FOUND',
    port: 'WESTPORT',
    language: 'MS',
    urgency: 'HIGH',
    confidence: 0.99,
    entities: {},
    short_explanation: 'Vehicle unavailable.',
    recommended_action: 'MANUAL_REVIEW',
  };
  const analyze = async () => {
    const token = randomUUID();
    await rpc('claim_support_analysis', [
      id,
      'fixture-classifier',
      'support-classify-v1',
      token,
      admin,
    ]);
    return rpc('complete_support_analysis', [id, token, classification]);
  };
  const source = await analyze();
  assert.equal((await claim(randomUUID())).error, 'NO_KNOWLEDGE');
  checks++;
  const article = {
    knowledge_code: 'KB-VEHICLE',
    title: 'Vehicle guidance',
    category: 'VEHICLE',
    subcategory: 'VEHICLE_NOT_FOUND',
    port: 'ALL',
    problem: 'Vehicle unavailable',
    possible_cause: null,
    resolution:
      'Staff should check registration guidance before advising the customer.',
    suggested_action: null,
    keywords: ['vehicle'],
    requires_port_verification: true,
    human_review_required: true,
    ai_reply_allowed: true,
    active: true,
  };
  let knowledge = await rpc('save_support_knowledge', [
    null,
    null,
    article,
    admin,
  ]);
  await rpc('save_support_knowledge', [
    null,
    null,
    { ...article, knowledge_code: 'KB-DISABLED', ai_reply_allowed: false },
    admin,
  ]);
  let token = randomUUID();
  let prepared = await claim(token);
  assert.equal(prepared.articles.length, 1);
  assert.equal(prepared.articles[0].id, knowledge.id);
  checks += 2;
  assert.equal((await claim(randomUUID())).error, 'BUSY');
  checks++;
  await rpc('release_support_reply', [id, randomUUID()]);
  assert.equal((await claim(randomUUID())).error, 'BUSY');
  checks++;
  assert.equal(
    (
      await rpc('complete_support_reply', [
        id,
        token,
        'Sila semak panduan.',
        [randomUUID()],
      ])
    ).error,
    'INVALID_SOURCES',
  );
  checks++;
  const saved = await rpc('complete_support_reply', [
    id,
    token,
    'Sila semak panduan pendaftaran. Pengesahan pelabuhan memerlukan semakan.',
    [knowledge.id],
  ]);
  let stored = (await rpc('get_support_reply', [id, saved.draft_id])).draft;
  assert.equal(stored.interaction.requires_human_review, true);
  assert.equal(stored.interaction.final_reply, null);
  assert.equal(stored.interaction.approved_by, null);
  assert.equal(stored.interaction.was_edited, null);
  assert.deepEqual(stored.interaction.knowledge_ids, [knowledge.id]);
  assert.equal(stored.source_analysis_id, source.id);
  assert.equal(stored.stale, false);
  checks += 7;
  assert.equal(
    (await rpc('get_support_analysis', [id])).interaction.id,
    source.id,
  );
  assert.equal((await claim(randomUUID())).cached_id, stored.id);
  checks += 2;
  const original = stored.interaction.generated_reply;
  assert.equal(
    (
      await rpc('edit_support_reply', [
        stored.id,
        '2000-01-01T00:00:00Z',
        'Lost edit',
        admin,
      ])
    ).error,
    'CONFLICT',
  );
  checks++;
  const before = stored.updated_at;
  stored = (
    await rpc('edit_support_reply', [
      stored.id,
      before,
      'Staff reviewed wording.',
      admin,
    ])
  ).draft;
  assert.equal(stored.edited_reply, 'Staff reviewed wording.');
  assert.equal(stored.interaction.generated_reply, original);
  assert.equal(stored.interaction.final_reply, null);
  assert.equal(
    (await rpc('edit_support_reply', [stored.id, before, 'Overwritten', admin]))
      .error,
    'CONFLICT',
  );
  checks += 4;
  // A knowledge edit invalidates existing drafts and fences an in-flight reply.
  knowledge = await rpc('save_support_knowledge', [
    knowledge.id,
    knowledge.updated_at,
    { ...article, resolution: 'Updated approved guidance.' },
    admin,
  ]);
  assert.equal(
    (await rpc('get_support_reply', [id, stored.id])).draft.stale,
    true,
  );
  checks++;
  token = randomUUID();
  await claim(token);
  knowledge = await rpc('save_support_knowledge', [
    knowledge.id,
    knowledge.updated_at,
    { ...article, active: false },
    admin,
  ]);
  assert.equal(
    (
      await rpc('complete_support_reply', [
        id,
        token,
        'Guidance.',
        [knowledge.id],
      ])
    ).error,
    'STALE_KNOWLEDGE',
  );
  checks++;
  await rpc('release_support_reply', [id, token]);
  assert.equal((await claim(randomUUID())).error, 'NO_KNOWLEDGE');
  checks++;
  token = randomUUID();
  await claim(token, 'ACKNOWLEDGE', 'support-static-v1');
  const safe = await rpc('complete_support_reply', [
    id,
    token,
    'Terima kasih kerana menghubungi CargoMove.',
    [],
  ]);
  assert.deepEqual(
    (await rpc('get_support_reply', [id, safe.draft_id])).draft.interaction
      .knowledge_ids,
    [],
  );
  checks++;
  await addMessage('New customer message');
  assert.equal((await claim(randomUUID(), 'ACKNOWLEDGE')).error, 'STALE');
  assert.equal(
    (await rpc('get_support_reply', [id, safe.draft_id])).draft.stale,
    true,
  );
  checks += 2;
  await analyze();
  token = randomUUID();
  await claim(token, 'REQUEST_DETAILS');
  await addMessage('Concurrent update');
  assert.equal(
    (
      await rpc('complete_support_reply', [
        id,
        token,
        'Please provide details.',
        [],
      ])
    ).error,
    'STALE',
  );
  checks++;
  await rpc('release_support_reply', [id, token]);
  await analyze();
  token = randomUUID();
  await claim(token, 'REQUEST_DETAILS');
  await db.exec(
    "update support_reply_generation_state set expires_at=clock_timestamp()-interval '1 second'",
  );
  assert.equal(
    (
      await rpc('complete_support_reply', [
        id,
        token,
        'Please provide details.',
        [],
      ])
    ).error,
    'STALE',
  );
  checks++;
  await rpc('release_support_reply', [id, token]);
  // Actual handler + SDK + real SQL, HTTP completely intercepted.
  knowledge = await rpc('save_support_knowledge', [
    knowledge.id,
    knowledge.updated_at,
    article,
    admin,
  ]);
  process.env.VERCEL = '1';
  process.env.SESSION_SECRET = 'fixture-secret';
  process.env.SUPABASE_URL = 'https://isolated-db.invalid';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'fixture-service';
  process.env.GEMINI_API_KEY = 'fixture-key';
  process.env.GEMINI_SUPPORT_MODEL = 'fixture-model';
  const { signSession } = await import('../api/_runtime.ts');
  const { replyGenerate, replyEdit } =
    await import('../server-handlers/ai/reply-handlers.ts');
  const cookie =
    'cargomove_session=' +
    signSession({
      id: admin,
      email: 'staff@example.com',
      type: 'ADMIN',
      exp: Date.now() + 60000,
    });
  const previousFetch = globalThis.fetch;
  let mode = 'valid',
    calls = 0;
  globalThis.fetch = async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init),
      url = new URL(request.url),
      body = JSON.parse(await request.text());
    if (url.hostname === 'generativelanguage.googleapis.com') {
      calls++;
      assert.ok(!JSON.stringify(body).includes('fixture private secret'));
      assert.ok(!JSON.stringify(body).includes('customer@example.com'));
      const payload = JSON.parse(body.contents[0].parts[0].text);
      assert.equal(payload.knowledge.length, 1);
      assert.equal(payload.knowledge[0].id, knowledge.id);
      if (mode === 'failure')
        return Response.json(
          { error: { code: 503, message: 'fixture failure' } },
          { status: 503 },
        );
      return Response.json({
        candidates: [
          {
            content: {
              role: 'model',
              parts: [
                { thought: true, text: 'private hidden reasoning' },
                {
                  text: JSON.stringify({
                    reply_text:
                      'Sila semak panduan pendaftaran. Pengesahan pelabuhan diperlukan.',
                    knowledge_ids: [
                      mode === 'invalid' ? randomUUID() : knowledge.id,
                    ],
                  }),
                },
              ],
            },
            finishReason: 'STOP',
          },
        ],
      });
    }
    assert.equal(url.hostname, 'isolated-db.invalid');
    const signatures = {
      claim_support_reply: [
        'p_id',
        'p_template',
        'p_model',
        'p_version',
        'p_token',
        'p_admin',
      ],
      complete_support_reply: ['p_id', 'p_token', 'p_text', 'p_knowledge_ids'],
      release_support_reply: ['p_id', 'p_token'],
      get_support_reply: ['p_case', 'p_draft'],
      edit_support_reply: ['p_id', 'p_expected', 'p_text', 'p_admin'],
    };
    const fn = url.pathname.split('/').pop();
    assert.ok(signatures[fn]);
    try {
      return Response.json(
        (await rpc(
          fn,
          signatures[fn].map((k) => body[k]),
        )) ?? null,
      );
    } catch (e) {
      return Response.json({ message: e.message }, { status: 400 });
    }
  };
  async function run(handler, method, body) {
    let status = 200,
      result;
    const response = {
      setHeader() {},
      status(n) {
        status = n;
        return this;
      },
      json(value) {
        result = value;
        return this;
      },
    };
    await handler({ method, body, query: {}, headers: { cookie } }, response);
    return { status, result };
  }
  try {
    let outcome = await run(replyGenerate, 'POST', {
      case_id: id,
      template_id: 'KNOWLEDGE',
    });
    assert.equal(outcome.status, 200, JSON.stringify(outcome.result));
    assert.ok(
      !JSON.stringify(outcome.result).includes('private hidden reasoning'),
    );
    const draft = outcome.result.draft;
    assert.equal(draft.interaction.requires_human_review, true);
    checks += 3;
    const firstCalls = calls;
    outcome = await run(replyGenerate, 'POST', {
      case_id: id,
      template_id: 'KNOWLEDGE',
    });
    assert.equal(outcome.result.cached, true);
    assert.equal(calls, firstCalls);
    checks += 2;
    outcome = await run(replyEdit, 'PUT', {
      id: draft.id,
      updated_at: draft.updated_at,
      reply_text: 'Reviewed reply.',
    });
    assert.equal(outcome.status, 200);
    assert.equal(
      outcome.result.draft.interaction.generated_reply,
      draft.interaction.generated_reply,
    );
    checks += 2;
    await addMessage('Vehicle XYZ123 still unavailable at Westport');
    await analyze();
    mode = 'failure';
    outcome = await run(replyGenerate, 'POST', {
      case_id: id,
      template_id: 'KNOWLEDGE',
    });
    assert.equal(outcome.status, 503);
    assert.equal(
      (await db.query('select token from support_reply_generation_state'))
        .rows[0].token,
      null,
    );
    checks += 2;
    mode = 'invalid';
    outcome = await run(replyGenerate, 'POST', {
      case_id: id,
      template_id: 'KNOWLEDGE',
    });
    assert.equal(outcome.status, 502);
    checks++;
    delete process.env.GEMINI_API_KEY;
    outcome = await run(replyGenerate, 'POST', {
      case_id: id,
      template_id: 'ACKNOWLEDGE',
    });
    assert.equal(outcome.status, 200);
    assert.equal(outcome.result.draft.interaction.model, 'support-static-v1');
    checks += 2;
  } finally {
    globalThis.fetch = previousFetch;
  }
  await db.exec("update support_cases set status='RESOLVED',resolved_at=now()");
  assert.equal((await claim(randomUUID(), 'ACKNOWLEDGE')).error, 'RESOLVED');
  checks++;
  await db.exec('reset role');
  for (const role of ['anon', 'authenticated']) {
    for (const fn of [
      'claim_support_reply(uuid,text,text,text,uuid,uuid)',
      'complete_support_reply(uuid,uuid,text,uuid[])',
      'get_support_reply(uuid,uuid)',
      'edit_support_reply(uuid,timestamptz,text,uuid)',
    ]) {
      assert.equal(
        (
          await db.query("select has_function_privilege($1,$2,'EXECUTE')ok", [
            role,
            fn,
          ])
        ).rows[0].ok,
        false,
      );
      checks++;
    }
    for (const table of [
      'support_reply_drafts',
      'support_reply_generation_state',
    ]) {
      assert.equal(
        (
          await db.query("select has_table_privilege($1,$2,'SELECT')ok", [
            role,
            table,
          ])
        ).rows[0].ok,
        false,
      );
      checks++;
    }
  }
  console.log(`${checks} isolated reply database/SDK/API checks passed.`);
} finally {
  await db.close();
}
