import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const migration = readFileSync(
  new URL('../supabase/migrations/20261025020000_sync_company_details_to_registrations.sql', import.meta.url),
  'utf8',
);

async function fixture() {
  const db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create table companies (
      id text primary key, registration_number text not null,
      registration_number_old text, registration_number_new text, name text not null,
      short_name text not null default '', company_type text not null,
      haulier_id text, forwarding_agent_id text, port_id text, depot_id text,
      details jsonb not null default '{}'::jsonb, ledger_codes text,
      block text, address1 text, address2 text, city text, state text, postcode text,
      country text, contact_name text, contact_email text, contact_designation text,
      contact_mobile text, office_phone text, fax text
    );
    create table registration_submissions (
      id text primary key, company_id text, company_reg_no text, company_name text,
      company_type text, port_id text, data jsonb not null default '{}'::jsonb
    );
    create table user_registrations (id text primary key, company_id text, company_name text);
    create table external_user_access (id text primary key, company_id text, company_name text);

    insert into companies (id,registration_number,registration_number_old,name,short_name,company_type,
      port_id,details,address1,contact_name)
    values ('company','OLD-1','OLD-1','OLD COMPANY','OLD','TRANSPORT','port-a',
      '{"assigned_port_ids":["port-a"]}','Old address','Old contact');
    insert into registration_submissions values
      ('linked','company','OLD-1','STALE COMPANY','HAULAGE','submission-port',
       '{"company":{"name":"STALE COMPANY","address1":"Stale address"},"drivers":[{"name":"Driver One"}]}'),
      ('other','other','OTHER-1','OTHER COMPANY','HAULAGE','other-port','{}');
    insert into user_registrations values ('user','company','STALE COMPANY');
    insert into external_user_access values ('external','company','STALE COMPANY');
  `);
  await db.exec(migration);
  return db;
}

test('Company Master edits synchronize linked registration snapshots and user company names', async () => {
  const db = await fixture();
  try {
    const backfilled = (await db.query<any>(`select * from registration_submissions where id='linked'`)).rows[0];
    assert.equal(backfilled.company_name, 'OLD COMPANY', 'migration repairs existing mismatches');

    await db.exec(`update companies set
      registration_number_old='NEW-2', name='NEW COMPANY SDN BHD', short_name='NEW CO',
      company_type='FORWARDER', address1='New address', contact_name='New contact',
      details='{"assigned_port_ids":["port-b"]}'
      where id='company'`);

    const linked = (await db.query<any>(`select * from registration_submissions where id='linked'`)).rows[0];
    assert.equal(linked.company_reg_no, 'NEW-2');
    assert.equal(linked.company_name, 'NEW COMPANY SDN BHD');
    assert.equal(linked.company_type, 'FORWARDER');
    assert.equal(linked.port_id, 'submission-port', 'submission facility remains unchanged');
    assert.equal(linked.data.company.short_name, 'NEW CO');
    assert.equal(linked.data.company.address1, 'New address');
    assert.deepEqual(linked.data.company.assigned_port_ids, ['port-b']);
    assert.deepEqual(linked.data.drivers, [{ name: 'Driver One' }], 'asset data remains unchanged');

    const other = (await db.query<any>(`select company_name from registration_submissions where id='other'`)).rows[0];
    assert.equal(other.company_name, 'OTHER COMPANY');
    assert.equal((await db.query<any>(`select company_name from user_registrations where id='user'`)).rows[0].company_name, 'NEW COMPANY SDN BHD');
    assert.equal((await db.query<any>(`select company_name from external_user_access where id='external'`)).rows[0].company_name, 'NEW COMPANY SDN BHD');
  } finally {
    await db.close();
  }
});

test('company detail synchronization migration is safe to rerun', async () => {
  const db = await fixture();
  try {
    await db.exec(migration);
    const count = (await db.query<any>(`
      select count(*)::int as count from pg_trigger
      where tgrelid='companies'::regclass and tgname='sync_company_details_from_master'
    `)).rows[0].count;
    assert.equal(count, 1);
  } finally {
    await db.close();
  }
});
