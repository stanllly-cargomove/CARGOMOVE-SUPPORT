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
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
    create schema auth;create table auth.users(id uuid primary key,email text);
    create table public.user_registrations(id text primary key,email text,full_name text,type text);
    grant usage on schema public to anon,authenticated,service_role;
    ${baseline.match(/create or replace function public.touch_updated_at\(\)[\s\S]*?\$\$;/)[0]}`);
  for (const file of [
    '20260916000000_support_foundation.sql',
    '20260916000020_support_inbox_queries.sql',
  ])
    await db.exec(await readFile(`supabase/migrations/${file}`, 'utf8'));
  const staff = randomUUID(),
    first = randomUUID(),
    second = randomUUID();
  await db.query('insert into auth.users values($1,$2)', [
    staff,
    'agent@example.com',
  ]);
  await db.exec(
    "insert into user_registrations values('app-admin','agent@example.com','Support Agent','ADMIN')",
  );
  await db.query(
    "insert into support_cases(id,customer_email,subject,category,port,assigned_to,ai_confidence) values ($1,'customer@example.com','Vehicle help','VEHICLE','WESTPORT',$2,0.95)",
    [first, staff],
  );
  await db.query(
    "insert into support_cases(id,customer_email,subject,status,resolved_at) values ($1,'resolved@example.com','Done','RESOLVED',now())",
    [second],
  );
  for (let n = 0; n < 55; n++)
    await db.query(
      "insert into support_messages(case_id,direction,sender_email,recipient_email,body_text,sent_at) values($1,'INBOUND','customer@example.com','support@example.com',$2,$3)",
      [
        first,
        `Company ABC vehicle XYZ123 booking REF${n}`,
        new Date(Date.now() + n * 1000).toISOString(),
      ],
    );
  await db.exec('set role service_role');
  const query = async (filters) =>
    (await db.query('select list_support_cases($1) as result', [filters]))
      .rows[0].result;
  const all = await query({});
  assert.equal(all.total, 2);
  assert.equal(all.assignees[0].name, 'Support Agent');
  checks += 2;
  for (const filters of [
    { q: 'XYZ123' },
    { q: 'REF54' },
    { q: 'Company ABC' },
    { category: 'VEHICLE', port: 'WESTPORT' },
    { assigned_to: staff },
    { confidence: 'HIGH' },
    { status: 'NEW' },
  ]) {
    assert.equal((await query(filters)).total, 1);
    checks++;
  }
  assert.equal((await query({ q: '%' })).total, 0);
  assert.equal((await query({ confidence: 'NONE' })).total, 1);
  assert.equal((await query({ assigned_to: 'UNASSIGNED' })).total, 1);
  checks += 3;
  assert.equal((await query({ offset: 20 })).cases.length, 0);
  checks++;
  const detail = async (offset) =>
    (
      await db.query('select get_support_case($1,$2) as result', [
        first,
        offset,
      ])
    ).rows[0].result;
  const latest = await detail(0),
    older = await detail(50);
  assert.equal(latest.message_total, 55);
  assert.equal(latest.messages.length, 50);
  assert.equal(older.messages.length, 5);
  checks += 3;
  assert.equal(latest.supportCase.assigned_name, 'Support Agent');
  assert.equal(latest.messages[49].body_text.includes('REF54'), true);
  assert.equal(older.messages[0].body_text.includes('REF0'), true);
  checks += 3;
  assert.equal(
    (await db.query('select get_support_case($1) as result', [randomUUID()]))
      .rows[0].result,
    null,
  );
  checks++;
  const stats = (await db.query('select support_inbox_stats() as result'))
    .rows[0].result;
  assert.equal(stats.total_cases, 2);
  assert.equal(stats.open_cases, 1);
  assert.equal(stats.resolved_today, 1);
  assert.equal(stats.new_cases, 1);
  checks += 4;
  await db.exec('reset role');
  for (const role of ['anon', 'authenticated']) {
    await db.exec(`set role ${role}`);
    for (const sql of [
      "select list_support_cases('{}')",
      `select get_support_case('${first}')`,
      'select support_inbox_stats()',
    ]) {
      await assert.rejects(db.query(sql), (e) => e.code === '42501');
      checks++;
    }
    await db.exec('reset role');
  }
  console.log(`${checks} support query and security checks passed.`);
} finally {
  await db.close();
}
