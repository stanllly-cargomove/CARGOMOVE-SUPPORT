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
  ])
    await db.exec(await readFile(`supabase/migrations/${file}`, 'utf8'));
  const admin = randomUUID(),
    id = randomUUID();
  await db.query('insert into auth.users values($1,$2)', [
    admin,
    'staff@example.com',
  ]);
  await db.query(
    "insert into support_cases(id,customer_email,subject)values($1,'customer@example.com','Vehicle XYZ123 cannot book at Westport')",
    [id],
  );
  await db.query(
    "insert into support_messages(case_id,direction,sender_email,recipient_email,body_text,sent_at)values($1,'INBOUND','customer@example.com','staff@example.com','Vehicle XYZ123 cannot book at Westport',now())",
    [id],
  );
  await db.exec('set role service_role');
  const rpc = async (name, args) =>
    (
      await db.query(
        `select ${name}(${args.map((_, i) => '$' + (i + 1)).join(',')})result`,
        args,
      )
    ).rows[0].result;
  const article = {
    knowledge_code: 'KB-GENERAL',
    title: 'Vehicle guidance',
    category: 'VEHICLE',
    subcategory: null,
    port: 'ALL',
    problem: 'Vehicle unavailable',
    possible_cause: null,
    resolution: 'Check approved vehicle guidance.',
    suggested_action: null,
    keywords: ['vehicle'],
    requires_port_verification: false,
    human_review_required: true,
    ai_reply_allowed: false,
    active: false,
  };
  const save = (input, existing) =>
    rpc('save_support_knowledge', [
      existing?.id || null,
      existing?.updated_at || null,
      input,
      admin,
    ]);
  let general = await save(article);
  assert.equal(general.active, false);
  assert.equal(general.created_by, admin);
  assert.equal(general.updated_by, admin);
  checks += 3;
  assert.equal((await save(article)).error, 'DUPLICATE_CODE');
  checks++;
  assert.equal(
    (
      await save(
        { ...article, title: 'Overwritten' },
        { id: general.id, updated_at: '2000-01-01T00:00:00Z' },
      )
    ).error,
    'CONFLICT',
  );
  checks++;
  assert.equal(
    (await save(article, { id: randomUUID(), updated_at: general.updated_at }))
      .error,
    'NOT_FOUND',
  );
  checks++;
  general = await save({ ...article, active: true }, general);
  assert.equal(general.active, true);
  checks++;
  const exact = await save({
    ...article,
    knowledge_code: 'KB-EXACT',
    subcategory: 'VEHICLE_NOT_FOUND',
    port: 'WESTPORT',
    active: true,
  });
  await save({
    ...article,
    knowledge_code: 'KB-INACTIVE',
    subcategory: 'VEHICLE_NOT_FOUND',
    port: 'WESTPORT',
  });
  await save({
    ...article,
    knowledge_code: 'KB-WRONG-PORT',
    port: 'NORTHPORT',
    active: true,
  });
  await save({
    ...article,
    knowledge_code: 'KB-WRONG-SUBCATEGORY',
    subcategory: 'VEHICLE_ACTIVATION',
    active: true,
  });
  await save({
    ...article,
    knowledge_code: 'KB-WRONG-CATEGORY',
    category: 'DRIVER',
    active: true,
  });
  const filters = async (input) => rpc('list_support_knowledge', [input]);
  assert.equal((await filters({})).total, 6);
  assert.equal((await filters({ active: 'false' })).total, 1);
  assert.equal(
    (await filters({ port: 'WESTPORT', subcategory: 'VEHICLE_NOT_FOUND' }))
      .total,
    2,
  );
  assert.equal((await filters({ q: 'approved vehicle guidance' })).total, 6);
  assert.equal((await filters({ q: '%' })).total, 0);
  assert.equal((await filters({ ai_reply_allowed: 'true' })).total, 0);
  checks += 6;
  assert.equal(
    (await rpc('match_support_knowledge', [id])).interaction_id,
    null,
  );
  checks++;
  const token = randomUUID();
  await rpc('claim_support_analysis', [
    id,
    'fixture-model',
    'support-classify-v1',
    token,
    admin,
  ]);
  const classification = {
    category: 'VEHICLE',
    subcategory: 'VEHICLE_NOT_FOUND',
    port: 'WESTPORT',
    language: 'EN',
    urgency: 'NORMAL',
    confidence: 0.95,
    entities: {},
    short_explanation: 'Vehicle unavailable.',
    recommended_action: 'MANUAL_REVIEW',
  };
  const interaction = await rpc('complete_support_analysis', [
    id,
    token,
    classification,
  ]);
  let result = await rpc('match_support_knowledge', [id]);
  assert.equal(result.interaction_id, interaction.id);
  assert.equal(result.articles.length, 2);
  assert.equal(result.articles[0].id, exact.id);
  assert.equal(result.articles[1].id, general.id);
  assert.equal(result.articles[0].ai_reply_allowed, false);
  checks += 5;
  await save({ ...exact, active: false }, exact);
  result = await rpc('match_support_knowledge', [id]);
  assert.equal(result.articles.length, 1);
  assert.equal(result.articles[0].id, general.id);
  checks += 2;
  await db.query(
    "update support_messages set body_text='New customer context' where case_id=$1",
    [id],
  );
  result = await rpc('match_support_knowledge', [id]);
  assert.equal(result.stale, true);
  assert.equal(result.articles.length, 0);
  checks += 2;
  // Unknown port/subcategory must not pick specific operational scopes.
  const token2 = randomUUID();
  await rpc('claim_support_analysis', [
    id,
    'fixture-model',
    'support-classify-v1',
    token2,
    admin,
  ]);
  await rpc('complete_support_analysis', [
    id,
    token2,
    { ...classification, subcategory: null, port: 'UNKNOWN' },
  ]);
  result = await rpc('match_support_knowledge', [id]);
  assert.deepEqual(
    result.articles.map((k) => k.id),
    [general.id],
  );
  checks++;
  for (let n = 0; n < 20; n++)
    await save({ ...article, knowledge_code: `KB-PAGE-${n}`, active: true });
  assert.equal((await filters({})).articles.length, 20);
  assert.equal((await filters({ offset: 20 })).articles.length, 6);
  checks += 2;
  result = await rpc('match_support_knowledge', [id]);
  assert.equal(result.articles.length, 5);
  checks++;
  assert.equal(await rpc('match_support_knowledge', [randomUUID()]), null);
  checks++;
  // Actual ADMIN handler uses modeled PostgREST backed by migrated SQL.
  process.env.VERCEL = '1';
  process.env.SESSION_SECRET = 'fixture-secret';
  process.env.SUPABASE_URL = 'https://isolated-db.invalid';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'fixture-service';
  const { signSession } = await import('../api/_runtime.ts');
  const { default: handler } =
    await import('../server-handlers/knowledge/articles.ts');
  const cookie =
    'cargomove_session=' +
    signSession({
      id: admin,
      email: 'staff@example.com',
      type: 'ADMIN',
      exp: Date.now() + 60000,
    });
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    assert.equal(new URL(String(url)).hostname, 'isolated-db.invalid');
    const body = JSON.parse(init.body);
    const signatures = {
      save_support_knowledge: ['p_id', 'p_expected', 'p_article', 'p_admin'],
      list_support_knowledge: ['p_filters'],
    };
    const fn = new URL(String(url)).pathname.split('/').pop();
    assert.ok(signatures[fn]);
    return Response.json(
      await rpc(
        fn,
        signatures[fn].map((k) => body[k]),
      ),
    );
  };
  async function run(method, body, query = {}) {
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
    await handler({ method, body, query, headers: { cookie } }, response);
    return { status, result };
  }
  try {
    let outcome = await run('POST', {
      article: {
        ...article,
        knowledge_code: 'KB-API',
        created_by: randomUUID(),
      },
    });
    assert.equal(outcome.status, 201);
    assert.equal(outcome.result.created_by, admin);
    checks += 2;
    const stored = outcome.result;
    outcome = await run('PUT', {
      id: stored.id,
      updated_at: stored.updated_at,
      article: { ...stored, active: true },
    });
    assert.equal(outcome.status, 200);
    assert.equal(outcome.result.active, true);
    checks += 2;
    outcome = await run('PUT', {
      id: stored.id,
      updated_at: stored.updated_at,
      article: { ...stored, title: 'Lost edit' },
    });
    assert.equal(outcome.status, 409);
    checks++;
    outcome = await run('GET', {}, { q: 'KB-API' });
    assert.equal(outcome.result.total, 1);
    checks++;
    outcome = await run('POST', {
      article: {
        ...article,
        knowledge_code: 'KB-UNSAFE',
        requires_port_verification: true,
        human_review_required: false,
      },
    });
    assert.equal(outcome.status, 400);
    checks++;
  } finally {
    globalThis.fetch = original;
  }
  await db.exec('reset role');
  for (const role of ['anon', 'authenticated']) {
    for (const fn of [
      'list_support_knowledge(jsonb)',
      'save_support_knowledge(uuid,timestamptz,jsonb,uuid)',
      'match_support_knowledge(uuid)',
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
  }
  console.log(`${checks} isolated knowledge database/API checks passed.`);
} finally {
  await db.close();
}
