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
  ])
    await db.exec(await readFile(`supabase/migrations/${file}`, 'utf8'));
  const id = randomUUID(),
    staff = randomUUID();
  await db.query('insert into auth.users values($1,$2)', [
    staff,
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
    'Kenderaan XYZ123 tidak ditemui at Westport. password: private secret',
  );
  await db.exec('set role service_role');
  const rpc = async (name, args) =>
    (
      await db.query(
        `select ${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) as result`,
        args,
      )
    ).rows[0].result;
  const classification = {
    category: 'VEHICLE',
    subcategory: 'VEHICLE_NOT_FOUND',
    port: 'WESTPORT',
    language: 'MIXED_MS_EN',
    urgency: 'HIGH',
    confidence: 0.99,
    entities: {
      company_name: null,
      vehicle_number: 'XYZ123',
      driver_name: null,
      driver_identifier: null,
      container_number: null,
      booking_number: null,
      vessel: null,
      port: null,
      warehouse: null,
      error_message: null,
    },
    recommended_action: 'VERIFY_WITH_PORT',
    requires_human_review: false,
    short_explanation: 'Customer reports vehicle XYZ123 is unavailable.',
  };
  const claim = (token) =>
    rpc('claim_support_analysis', [
      id,
      'fixture-model',
      'support-classify-v1',
      token,
      staff,
    ]);
  let token = randomUUID();
  assert.ok((await claim(token)).messages.length);
  checks++;
  assert.equal((await claim(randomUUID())).error, 'BUSY');
  checks++;
  await rpc('release_support_analysis', [id, randomUUID()]);
  assert.equal((await claim(randomUUID())).error, 'BUSY');
  checks++;
  await addMessage('Vehicle XYZ123 still missing at Westport');
  assert.equal(
    (await rpc('complete_support_analysis', [id, token, classification])).error,
    'STALE',
  );
  checks++;
  assert.equal(
    (await db.query('select count(*)::int n from ai_interactions')).rows[0].n,
    0,
  );
  checks++;
  token = randomUUID();
  await claim(token);
  await db.exec("update support_cases set status='ESCALATED'");
  assert.equal(
    (await rpc('complete_support_analysis', [id, token, classification])).error,
    'STALE',
  );
  checks++;
  token = randomUUID();
  await claim(token);
  const stored = await rpc('complete_support_analysis', [
    id,
    token,
    classification,
  ]);
  assert.equal(stored.requires_human_review, true);
  assert.equal(stored.generated_reply, null);
  assert.equal(stored.final_reply, null);
  assert.equal(stored.requested_by, staff);
  checks += 4;
  assert.equal(
    (await db.query('select status from support_cases')).rows[0].status,
    'ESCALATED',
  );
  checks++;
  assert.equal((await claim(randomUUID())).cached.id, stored.id);
  checks++;
  assert.equal((await rpc('get_support_analysis', [id])).stale, false);
  checks++;
  await addMessage('New customer followup');
  assert.equal((await rpc('get_support_analysis', [id])).stale, true);
  checks++;
  token = randomUUID();
  await claim(token);
  await db.exec(
    "update support_ai_analysis_state set expires_at=clock_timestamp()-interval '1 second'",
  );
  assert.equal(
    (await rpc('complete_support_analysis', [id, token, classification])).error,
    'STALE',
  );
  checks++;
  token = randomUUID();
  assert.ok((await claim(token)).messages);
  await rpc('release_support_analysis', [id, token]);
  checks++;
  await db.exec("update support_cases set status='NEW'");
  // Actual handler, SDK request and SQL functions, with all HTTP replaced by fixtures.
  process.env.VERCEL = '1';
  process.env.SESSION_SECRET = 'fixture-session';
  process.env.SUPABASE_URL = 'https://isolated-db.invalid';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'fixture-role';
  process.env.GEMINI_API_KEY = 'fixture-ai-key';
  process.env.GEMINI_SUPPORT_MODEL = 'fixture-model';
  const { signSession } = await import('../api/_runtime.ts');
  const { default: analyze } = await import('../server-handlers/ai/analyze.ts');
  const cookie =
    'cargomove_session=' +
    signSession({
      id: staff,
      email: 'staff@example.com',
      type: 'ADMIN',
      exp: Date.now() + 60000,
    });
  const original = globalThis.fetch;
  let providerCalls = 0,
    mode = 'valid';
  globalThis.fetch = async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const url = new URL(request.url);
    const body = JSON.parse(await request.text());
    if (url.hostname === 'generativelanguage.googleapis.com') {
      providerCalls++;
      assert.ok(!JSON.stringify(body).includes('private secret'));
      assert.ok(!JSON.stringify(body).includes('customer@example.com'));
      assert.equal(body.generationConfig.responseMimeType, 'application/json');
      if (mode === 'failure')
        return Response.json(
          { error: { code: 503, message: 'fixture failure' } },
          { status: 503 },
        );
      if (mode === 'stale') await addMessage('Concurrent customer update');
      return Response.json({
        candidates: [
          {
            content: {
              role: 'model',
              parts: [
                {
                  thought: true,
                  text: 'hidden fixture reasoning must not be stored',
                },
                {
                  text:
                    mode === 'invalid'
                      ? 'not json'
                      : JSON.stringify(classification),
                },
              ],
            },
            finishReason: 'STOP',
          },
        ],
      });
    }
    assert.equal(url.hostname, 'isolated-db.invalid');
    assert.equal(request.headers.get('apikey'), 'fixture-role');
    const fn = url.pathname.split('/').pop(),
      signatures = {
        claim_support_analysis: [
          'p_id',
          'p_model',
          'p_version',
          'p_token',
          'p_admin',
        ],
        complete_support_analysis: ['p_id', 'p_token', 'p_result'],
        release_support_analysis: ['p_id', 'p_token'],
      };
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
  async function run() {
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
    await analyze(
      { method: 'POST', headers: { cookie }, body: { case_id: id } },
      response,
    );
    return { status, result };
  }
  try {
    let outcome = await run();
    assert.equal(outcome.status, 200, JSON.stringify(outcome.result));
    assert.equal(outcome.result.interaction.requires_human_review, true);
    checks += 2;
    assert.equal(
      (await db.query('select status from support_cases')).rows[0].status,
      'NEEDS_REVIEW',
    );
    assert.ok(
      !JSON.stringify(outcome.result).includes('hidden fixture reasoning'),
    );
    checks += 2;
    const calls = providerCalls;
    outcome = await run();
    assert.equal(outcome.result.cached, true);
    assert.equal(providerCalls, calls);
    checks += 2;
    await addMessage('Customer asks to verify XYZ123 at Westport');
    mode = 'failure';
    outcome = await run();
    assert.equal(outcome.status, 503);
    assert.equal(
      (await db.query('select token from support_ai_analysis_state')).rows[0]
        .token,
      null,
    );
    checks += 2;
    mode = 'invalid';
    outcome = await run();
    assert.equal(outcome.status, 502);
    checks++;
    mode = 'stale';
    outcome = await run();
    assert.equal(outcome.status, 409);
    checks++;
  } finally {
    globalThis.fetch = original;
  }
  await db.exec('reset role');
  for (const role of ['anon', 'authenticated']) {
    assert.equal(
      (
        await db.query(
          "select has_table_privilege($1,'support_ai_analysis_state','SELECT') ok",
          [role],
        )
      ).rows[0].ok,
      false,
    );
    checks++;
    for (const fn of [
      'claim_support_analysis(uuid,text,text,uuid,uuid)',
      'complete_support_analysis(uuid,uuid,jsonb)',
      'get_support_analysis(uuid)',
    ]) {
      assert.equal(
        (
          await db.query("select has_function_privilege($1,$2,'EXECUTE') ok", [
            role,
            fn,
          ])
        ).rows[0].ok,
        false,
      );
      checks++;
    }
  }
  console.log(
    `${checks} isolated classification database and API checks passed.`,
  );
} finally {
  await db.close();
}
