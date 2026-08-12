/**
 * Run every migration against a real PostgreSQL, then prove the tenancy
 * boundary holds.
 *
 * A row-level-security policy is the one kind of code where "it compiles" and
 * "it is correct" are furthest apart. A policy with a typo still installs; a
 * policy that admits every signed-in caller still installs. The only way to
 * know a company cannot read another company's inspections is to create two
 * companies and try it, which is what the second half of this file does.
 *
 * Needs a database to talk to and the `psql` client. Point DATABASE_URL at a
 * throwaway instance — this drops and recreates the public schema.
 *
 *   DATABASE_URL=postgres://postgres@localhost:5432/postgres npm run check:migrations
 */
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const url = process.env.DATABASE_URL ?? 'postgres://postgres@localhost:5432/postgres';

let failures = 0;

function psql(sql, { expectError = false } = {}) {
  try {
    return execFileSync('psql', [url, '-v', 'ON_ERROR_STOP=1', '-X', '-q', '-t', '-A', '-c', sql], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch (error) {
    if (expectError) return { error: `${error.stderr ?? ''}`.trim() };
    throw new Error(`${error.stderr ?? error.message}`.trim());
  }
}

function psqlFile(path) {
  execFileSync('psql', [url, '-v', 'ON_ERROR_STOP=1', '-X', '-q', '-f', path], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function check(name, fn) {
  try {
    const problem = fn();
    if (problem) {
      failures += 1;
      console.log(`FAIL  ${name}\n      ${problem}`);
    } else {
      console.log(`  ok  ${name}`);
    }
  } catch (error) {
    failures += 1;
    console.log(`FAIL  ${name}\n      ${error.message.split('\n').slice(0, 4).join('\n      ')}`);
  }
}

/** Runs `sql` as a signed-in user, the way PostgREST would. */
function asUser(userId, sql, options) {
  return psql(
    `set local role authenticated;
     set local request.jwt.claims = '{"sub":"${userId}","role":"authenticated"}';
     ${sql}`,
    options,
  );
}

/** Wraps in a transaction so `set local` is scoped and nothing leaks between checks. */
function tx(userId, sql, options) {
  return asUser(userId, sql, options);
}

// ---------------------------------------------------------------------------
// Migrate
// ---------------------------------------------------------------------------

console.log(`\nDatabase: ${url.replace(/:[^:@/]*@/, ':***@')}\n`);

psql('drop schema if exists public cascade; create schema public;');
psql('drop schema if exists auth cascade; drop schema if exists storage cascade;');

psqlFile(join(here, 'supabase-shim.sql'));
console.log('  ok  supabase shim');

const migrations = readdirSync(join(root, 'supabase', 'migrations'))
  .filter((file) => file.endsWith('.sql'))
  .sort();

if (migrations.length === 0) {
  console.log('FAIL  no migrations found');
  process.exit(1);
}

for (const file of migrations) {
  check(`migration ${file}`, () => {
    psqlFile(join(root, 'supabase', 'migrations', file));
    return null;
  });
}

// Everything below reads a schema that did not finish being built, so the
// failures would all be consequences of the same one. Stop at the cause.
if (failures > 0) {
  console.log('\nMigrations did not apply cleanly — skipping the isolation checks.\n');
  process.exit(1);
}

// Supabase grants these by default on everything in `public`; the migrations
// rely on it and never say so themselves.
psql(`grant all on all tables in schema public to authenticated;
      grant all on all sequences in schema public to authenticated;
      grant execute on all functions in schema public to authenticated;`);

// ---------------------------------------------------------------------------
// Static checks — the shape of the schema
// ---------------------------------------------------------------------------

const TENANT_TABLES = [
  'templates',
  'shared_config',
  'customers',
  'inspections',
  'photos',
  'tombstones',
  'audit_log',
  'webhook_endpoints',
  'webhook_deliveries',
];

check('every tenant table carries org_id', () => {
  const missing = psql(`
    select t.name from unnest(array[${TENANT_TABLES.map((t) => `'${t}'`).join(',')}]) as t(name)
    where not exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = t.name and column_name = 'org_id'
    );`);
  return missing ? `no org_id on: ${missing.split('\n').join(', ')}` : null;
});

check('org_id is not null everywhere it exists', () => {
  // Base tables only — a view's columns are always reported nullable, and
  // `profiles.org_id` is nullable on purpose (an account with no invitation).
  const nullable = psql(`
    select c.table_name from information_schema.columns c
    join information_schema.tables t
      on t.table_schema = c.table_schema and t.table_name = c.table_name
    where c.table_schema = 'public' and c.column_name = 'org_id'
      and c.is_nullable = 'YES' and t.table_type = 'BASE TABLE'
      and c.table_name <> 'profiles';`);
  return nullable ? `nullable org_id on: ${nullable.split('\n').join(', ')}` : null;
});

check('row level security is on for every table', () => {
  const off = psql(`
    select relname from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;`);
  return off ? `RLS disabled on: ${off.split('\n').join(', ')}` : null;
});

check('no tenant policy admits every signed-in caller', () => {
  // `using (true)` was the old single-company shape. Anything still carrying it
  // on a tenant table is a hole straight through the boundary.
  const open = psql(`
    select tablename || '.' || policyname from pg_policies
    where schemaname = 'public'
      and tablename in (${TENANT_TABLES.map((t) => `'${t}'`).join(',')})
      and (qual = 'true' or with_check = 'true');`);
  return open ? `unscoped: ${open.split('\n').join(', ')}` : null;
});

check('every tenant policy mentions the org', () => {
  const loose = psql(`
    select tablename || '.' || policyname from pg_policies
    where schemaname = 'public'
      and tablename in (${TENANT_TABLES.map((t) => `'${t}'`).join(',')})
      and coalesce(qual, '') || coalesce(with_check, '') not like '%org_id%';`);
  return loose ? `no org check: ${loose.split('\n').join(', ')}` : null;
});

check('checklist ids are unique per company, not globally', () => {
  const key = psql(`
    select string_agg(a.attname, ',' order by k.ord)
    from pg_constraint c
    join lateral unnest(c.conkey) with ordinality as k(attnum, ord) on true
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
    where c.conrelid = 'public.templates'::regclass and c.contype = 'p';`);
  return key === 'org_id,id' ? null : `templates primary key is (${key})`;
});

check('storage policies check the org prefix', () => {
  const loose = psql(`
    select policyname from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and coalesce(qual, '') || coalesce(with_check, '') not like '%foldername%';`);
  return loose ? `no prefix check: ${loose.split('\n').join(', ')}` : null;
});

// ---------------------------------------------------------------------------
// The real test — two companies, and what one can see of the other
// ---------------------------------------------------------------------------

const ACME = '11111111-1111-1111-1111-111111111111';
const BETA = '22222222-2222-2222-2222-222222222222';
const ACME_ADMIN = '66666666-6666-6666-6666-666666666666';

psql(`
  insert into auth.users (id, email) values
    ('${ACME}', 'owner@acme.test'),
    ('${BETA}', 'owner@beta.test');

  insert into public.organizations (id, name, slug) values
    ('aaaaaaaa-0000-0000-0000-000000000001', 'Acme QC', 'acme'),
    ('bbbbbbbb-0000-0000-0000-000000000002', 'Beta QC', 'beta');

  update public.profiles set org_id = 'aaaaaaaa-0000-0000-0000-000000000001', role = 'owner'
   where id = '${ACME}';
  update public.profiles set org_id = 'bbbbbbbb-0000-0000-0000-000000000002', role = 'owner'
   where id = '${BETA}';

  insert into public.customers (id, org_id, customer_name, address, created_by) values
    ('cust-acme', 'aaaaaaaa-0000-0000-0000-000000000001', 'Acme Customer', '1 Acme Way', '${ACME}'),
    ('cust-beta', 'bbbbbbbb-0000-0000-0000-000000000002', 'Beta Customer', '2 Beta Rd', '${BETA}');

  insert into public.inspections (id, org_id, customer_id, snapshot, visit_type, created_by) values
    ('insp-acme', 'aaaaaaaa-0000-0000-0000-000000000001', 'cust-acme', '{}', 'site-visit', '${ACME}'),
    ('insp-beta', 'bbbbbbbb-0000-0000-0000-000000000002', 'cust-beta', '{}', 'site-visit', '${BETA}');
`);

check('the signup trigger created a profile for each account', () => {
  const count = psql(`select count(*) from public.profiles;`);
  return count === '2' ? null : `expected 2 profiles, found ${count}`;
});

// An admin at Acme, used by several checks below. Created through the
// invitation path rather than by hand, so it also exercises that path.
psql(`
  insert into public.invites (org_id, email, role, invited_by)
  values ('aaaaaaaa-0000-0000-0000-000000000001', 'admin@acme.test', 'admin', '${ACME}');
  insert into auth.users (id, email) values ('${ACME_ADMIN}', 'admin@acme.test');
`);

check('a company sees only its own customers', () => {
  const rows = tx(ACME, `select id from public.customers order by id;`);
  return rows === 'cust-acme' ? null : `Acme sees: ${rows.replace(/\n/g, ', ') || '(nothing)'}`;
});

check('a company sees only its own inspections', () => {
  const rows = tx(BETA, `select id from public.inspections order by id;`);
  return rows === 'insp-beta' ? null : `Beta sees: ${rows.replace(/\n/g, ', ') || '(nothing)'}`;
});

check('a company cannot read another roster', () => {
  // Acme's own membership grows as later fixtures are added, so the assertion
  // is about who is absent rather than an exact roll call.
  const rows = tx(ACME, `select email from public.profiles order by email;`)
    .split('\n')
    .filter(Boolean);
  const foreign = rows.filter((email) => !email.endsWith('@acme.test'));
  if (foreign.length > 0) return `Acme sees: ${foreign.join(', ')}`;
  return rows.includes('owner@acme.test') ? null : 'Acme cannot see its own owner';
});

check('a company cannot see another organization', () => {
  const rows = tx(BETA, `select slug from public.organizations order by slug;`);
  return rows === 'beta' ? null : `Beta sees: ${rows.replace(/\n/g, ', ') || '(nothing)'}`;
});

check('one company cannot update another\'s customer', () => {
  tx(ACME, `update public.customers set customer_name = 'seized' where id = 'cust-beta';`);
  const name = psql(`select customer_name from public.customers where id = 'cust-beta';`);
  return name === 'Beta Customer' ? null : `Beta's customer is now "${name}"`;
});

check('one company cannot delete another\'s inspection', () => {
  tx(ACME, `delete from public.inspections where id = 'insp-beta';`);
  const left = psql(`select count(*) from public.inspections where id = 'insp-beta';`);
  return left === '1' ? null : `Beta's inspection was deleted by Acme`;
});

check('a row cannot be inserted into another company', () => {
  const result = tx(
    ACME,
    `insert into public.customers (id, org_id, customer_name, address, created_by)
     values ('smuggled', 'bbbbbbbb-0000-0000-0000-000000000002', 'x', 'y', '${ACME}');`,
    { expectError: true },
  );
  return result?.error ? null : 'the insert was allowed';
});

check('org_id defaults to the caller\'s company when unstated', () => {
  tx(
    ACME,
    `insert into public.customers (id, customer_name, address, created_by)
     values ('cust-acme-2', 'Second', '3 Acme Way', '${ACME}');`,
  );
  const org = psql(`select org_id from public.customers where id = 'cust-acme-2';`);
  return org === 'aaaaaaaa-0000-0000-0000-000000000001' ? null : `landed in org ${org}`;
});

check('two companies can hold the same checklist id', () => {
  psql(`
    insert into public.templates (id, org_id, name, created_by) values
      ('home-performance', 'aaaaaaaa-0000-0000-0000-000000000001', 'Home Performance', '${ACME}'),
      ('home-performance', 'bbbbbbbb-0000-0000-0000-000000000002', 'Home Performance', '${BETA}');`);
  const rows = tx(ACME, `select name from public.templates;`);
  return rows.split('\n').filter(Boolean).length === 1 ? null : `Acme sees ${rows.split('\n').length} copies`;
});

check('each company keeps its own shared config', () => {
  psql(`
    insert into public.shared_config (org_id, info_fields) values
      ('aaaaaaaa-0000-0000-0000-000000000001', '[{"id":"acme"}]'),
      ('bbbbbbbb-0000-0000-0000-000000000002', '[{"id":"beta"}]');`);
  const seen = tx(ACME, `select info_fields::text from public.shared_config;`);
  return seen.includes('acme') && !seen.includes('beta') ? null : `Acme sees: ${seen}`;
});

check('a tombstone does not leak another company\'s ids', () => {
  psql(`delete from public.customers where id = 'cust-beta';`);
  const seen = tx(ACME, `select entity_id from public.tombstones;`);
  return seen.includes('cust-beta') ? 'Acme can read Beta\'s deletion' : null;
});

check('a photo object is unreadable from another company', () => {
  psql(`
    insert into storage.objects (bucket_id, name, owner)
    values ('inspection-photos', 'bbbbbbbb-0000-0000-0000-000000000002/insp-beta/p1.jpg', '${BETA}');`);
  const seen = tx(ACME, `select name from storage.objects;`);
  return seen ? `Acme sees: ${seen}` : null;
});

check('an account with no company sees nothing at all', () => {
  const orphan = '33333333-3333-3333-3333-333333333333';
  psql(`insert into auth.users (id, email) values ('${orphan}', 'nobody@nowhere.test');`);
  const org = psql(`select coalesce(org_id::text, 'null') from public.profiles where id = '${orphan}';`);
  if (org !== 'null') return `unexpectedly landed in org ${org}`;
  const rows = tx(orphan, `select count(*) from public.customers;`);
  return rows === '0' ? null : `sees ${rows} customers`;
});

check('an invitation puts the new account in the right company', () => {
  const invited = '44444444-4444-4444-4444-444444444444';
  psql(`
    insert into public.invites (org_id, email, role, invited_by)
    values ('bbbbbbbb-0000-0000-0000-000000000002', 'Crew@Beta.test', 'inspector', '${BETA}');
    insert into auth.users (id, email) values ('${invited}', 'crew@beta.test');`);
  const row = psql(`
    select coalesce(org_id::text, 'null') || ' ' || role from public.profiles where id = '${invited}';`);
  if (row !== 'bbbbbbbb-0000-0000-0000-000000000002 inspector') return `profile is: ${row}`;
  const accepted = psql(`select accepted_at is not null from public.invites where lower(email) = 'crew@beta.test';`);
  return accepted === 't' ? null : 'the invitation was not marked accepted';
});

check('a profile can read its own organization alongside itself', () => {
  // This is the shape of the query `src/lib/auth.tsx` runs on every sign-in.
  // It crosses two policies — the caller's profile, and the organization it
  // points at — and if the second one refuses, every user in every company
  // lands on the "no organization" screen with no other symptom.
  const row = tx(
    ACME,
    `select p.email || ' @ ' || o.name
       from public.profiles p
       join public.organizations o on o.id = p.org_id
      where p.id = '${ACME}';`,
  );
  return row === 'owner@acme.test @ Acme QC' ? null : `got: ${row || '(nothing)'}`;
});

check('the stored score is bounded and its verdict is a known word', () => {
  const badScore = psql(
    `update public.inspections set overall_score = 140 where id = 'insp-acme';`,
    { expectError: true },
  );
  if (!badScore?.error) return 'a score of 140 was accepted';

  const badStatus = psql(
    `update public.inspections set pass_fail_status = 'probably fine' where id = 'insp-acme';`,
    { expectError: true },
  );
  return badStatus?.error ? null : 'an unknown verdict was accepted';
});

check('the office summary reads the stored result rather than recounting', () => {
  // The view used to derive pass/fail itself, which made it a second
  // implementation of the scoring rule with nothing keeping the two in step.
  const columns = psql(`
    select string_agg(column_name, ',' order by column_name)
      from information_schema.columns
     where table_schema = 'public' and table_name = 'inspection_summary'
       and column_name in ('overall_score', 'pass_fail_status', 'total_deficiencies');`);
  return columns === 'overall_score,pass_fail_status,total_deficiencies'
    ? null
    : `the view exposes: ${columns || '(none of them)'}`;
});

check('reopening a signed inspection writes a ledger row', () => {
  psql(`
    insert into public.inspections (id, org_id, customer_id, snapshot, visit_type, status, created_by, completed_at)
    values ('insp-signed', 'aaaaaaaa-0000-0000-0000-000000000001', 'cust-acme', '{}',
            'final-walkthrough', 'completed', '${ACME}', now());`);

  tx(
    ACME,
    `update public.inspections
        set status = 'in-progress',
            completed_at = null,
            reopenings = '[{"reason":"Wrong permit number captured","at":"2026-08-12T00:00:00Z"}]'
      where id = 'insp-signed';`,
  );

  const row = psql(`
    select action || ' | ' || coalesce(reason, '(none)') || ' | ' || coalesce(actor_email, '(nobody)')
      from public.audit_log where entity_id = 'insp-signed';`);
  return row === 'reopen | Wrong permit number captured | owner@acme.test'
    ? null
    : `ledger says: ${row || '(nothing)'}`;
});

check('an ordinary edit does not write a ledger row', () => {
  // The trigger fires on every update. Firing on the wrong ones would bury the
  // reopenings in noise, which is the same as not recording them.
  const before = psql(`select count(*) from public.audit_log;`);
  tx(ACME, `update public.inspections set summary_notes = 'ordinary edit' where id = 'insp-signed';`);
  const after = psql(`select count(*) from public.audit_log;`);
  return before === after ? null : `the ledger grew from ${before} to ${after}`;
});

check('nobody can edit or delete a ledger row', () => {
  // There is deliberately no update or delete policy, so both match no rows
  // rather than raising. Silence is the expected answer; a changed row is not.
  tx(ACME, `update public.audit_log set reason = 'something more flattering';`);
  tx(ACME, `delete from public.audit_log;`);
  const row = psql(`select coalesce(reason, '') from public.audit_log where entity_id = 'insp-signed';`);
  return row === 'Wrong permit number captured' ? null : `the ledger now says: "${row}"`;
});

check('nobody can forge a ledger row', () => {
  const result = tx(
    ACME,
    `insert into public.audit_log (org_id, entity, entity_id, action)
     values ('aaaaaaaa-0000-0000-0000-000000000001', 'inspection', 'insp-acme', 'invented');`,
    { expectError: true },
  );
  return result?.error ? null : 'a client wrote straight into the ledger';
});

check('one company cannot read another\'s ledger', () => {
  const seen = tx(BETA, `select entity_id from public.audit_log;`);
  return seen.includes('insp-signed') ? 'Beta can read Acme\'s audit trail' : null;
});

check('an owner can withdraw an invitation, an admin cannot', () => {
  // The Edge Function creates invitations with the service key, but listing and
  // withdrawing them happen straight from the app through these policies.
  psql(`insert into public.invites (id, org_id, email, role, invited_by)
        values ('11111111-aaaa-aaaa-aaaa-111111111111',
                'aaaaaaaa-0000-0000-0000-000000000001', 'withdraw@acme.test', 'inspector', '${ACME}');`);

  // An admin may see who is outstanding...
  const seen = tx(ACME_ADMIN, `select email from public.invites where accepted_at is null;`);
  if (!seen.includes('withdraw@acme.test')) return 'an admin cannot see pending invitations';

  // ...but not withdraw one.
  tx(ACME_ADMIN, `delete from public.invites where id = '11111111-aaaa-aaaa-aaaa-111111111111';`);
  const afterAdmin = psql(
    `select count(*) from public.invites where id = '11111111-aaaa-aaaa-aaaa-111111111111';`,
  );
  if (afterAdmin !== '1') return 'an admin withdrew an invitation';

  tx(ACME, `delete from public.invites where id = '11111111-aaaa-aaaa-aaaa-111111111111';`);
  const afterOwner = psql(
    `select count(*) from public.invites where id = '11111111-aaaa-aaaa-aaaa-111111111111';`,
  );
  return afterOwner === '0' ? null : 'an owner could not withdraw an invitation';
});

check('one company cannot see or touch another\'s invitations', () => {
  psql(`insert into public.invites (id, org_id, email, role, invited_by)
        values ('22222222-bbbb-bbbb-bbbb-222222222222',
                'aaaaaaaa-0000-0000-0000-000000000001', 'secret@acme.test', 'admin', '${ACME}');`);

  const seen = tx(BETA, `select email from public.invites;`);
  if (seen.includes('secret@acme.test')) return 'Beta can read Acme\'s invitations';

  tx(BETA, `delete from public.invites where id = '22222222-bbbb-bbbb-bbbb-222222222222';`);
  const left = psql(
    `select count(*) from public.invites where id = '22222222-bbbb-bbbb-bbbb-222222222222';`,
  );
  return left === '1' ? null : 'Beta withdrew Acme\'s invitation';
});

check('an inspector cannot read invitations at all', () => {
  const crew = '55555555-5555-5555-5555-555555555555';
  const seen = tx(crew, `select count(*) from public.invites;`);
  return seen === '0' ? null : `an inspector sees ${seen} invitations`;
});

check('completing an inspection queues a delivery for each endpoint', () => {
  psql(`
    insert into public.webhook_endpoints (id, org_id, url, secret, created_by) values
      ('e1111111-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001',
       'https://acme.example/hooks/qc', 'shh', '${ACME}'),
      ('e1111111-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001',
       'https://acme.example/hooks/crm', 'shh', '${ACME}'),
      -- Switched off, and a different company's. Neither should be queued.
      ('e1111111-0000-0000-0000-000000000003', 'aaaaaaaa-0000-0000-0000-000000000001',
       'https://acme.example/hooks/old', 'shh', '${ACME}'),
      ('e2222222-0000-0000-0000-000000000004', 'bbbbbbbb-0000-0000-0000-000000000002',
       'https://beta.example/hooks/qc', 'shh', '${BETA}');
    update public.webhook_endpoints set active = false
      where id = 'e1111111-0000-0000-0000-000000000003';

    insert into public.inspections
      (id, org_id, customer_id, snapshot, visit_type, status, created_by, info,
       overall_score, pass_fail_status, total_deficiencies)
    values ('insp-hook', 'aaaaaaaa-0000-0000-0000-000000000001', 'cust-acme', '{}',
            'final-walkthrough', 'in-progress', '${ACME}', '{"inspector":"A. Holcombe"}',
            null, null, null);

    update public.inspections
       set status = 'completed', completed_at = now(),
           overall_score = 94, pass_fail_status = 'NEEDS_REVIEW', total_deficiencies = 1
     where id = 'insp-hook';`);

  const queued = psql(`
    select count(*) from public.webhook_deliveries
     where payload -> 'data' ->> 'inspection_id' = 'insp-hook';`);
  return queued === '2' ? null : `queued ${queued} deliveries, expected 2`;
});

check('the payload is the documented shape, not our own field names', () => {
  // Whoever receives this is integrating against the TRD's contract. The moment
  // it is easier to send the internal shape, the contract starts drifting.
  const body = psql(`
    select payload::text from public.webhook_deliveries
     where payload -> 'data' ->> 'inspection_id' = 'insp-hook' limit 1;`);
  const parsed = JSON.parse(body);

  if (parsed.event !== 'inspection.completed') return `event was ${parsed.event}`;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(parsed.timestamp)) {
    return `timestamp was ${parsed.timestamp}`;
  }
  for (const key of ['inspection_id', 'organization_id', 'site_id', 'inspector', 'summary']) {
    if (!(key in parsed.data)) return `data is missing ${key}`;
  }
  if (parsed.data.summary.overall_score !== 94) return `score was ${parsed.data.summary.overall_score}`;
  if (parsed.data.summary.pass_fail_status !== 'NEEDS_REVIEW') {
    return `verdict was ${parsed.data.summary.pass_fail_status}`;
  }
  if (parsed.data.inspector.name !== 'A. Holcombe') return `inspector was ${parsed.data.inspector.name}`;
  if (parsed.data.site?.customer_name !== 'Acme Customer') return `site was ${JSON.stringify(parsed.data.site)}`;
  return null;
});

check('the payload is frozen at completion, not read again later', () => {
  // An inspection can be reopened and amended. A delivery retrying an hour
  // later has to send the body it was always going to send.
  psql(`update public.inspections set overall_score = 12 where id = 'insp-hook';`);
  const score = psql(`
    select payload -> 'data' -> 'summary' ->> 'overall_score'
      from public.webhook_deliveries
     where payload -> 'data' ->> 'inspection_id' = 'insp-hook' limit 1;`);
  return score === '94' ? null : `the stored payload now says ${score}`;
});

check('an inspection that arrives already completed still fires', () => {
  // The app is offline-first: a whole visit can be walked and signed with no
  // signal and reach the server in a single insert, never passing through
  // in-progress on this side at all.
  psql(`
    insert into public.inspections
      (id, org_id, customer_id, snapshot, visit_type, status, created_by, completed_at)
    values ('insp-offline', 'aaaaaaaa-0000-0000-0000-000000000001', 'cust-acme', '{}',
            'site-visit', 'completed', '${ACME}', now());`);
  const queued = psql(`
    select count(*) from public.webhook_deliveries
     where payload -> 'data' ->> 'inspection_id' = 'insp-offline';`);
  return queued === '2' ? null : `queued ${queued}, expected 2`;
});

check('an ordinary edit to a completed inspection queues nothing more', () => {
  const before = psql(`select count(*) from public.webhook_deliveries;`);
  psql(`update public.inspections set summary_notes = 'tidied up' where id = 'insp-hook';`);
  const after = psql(`select count(*) from public.webhook_deliveries;`);
  return before === after ? null : `the queue grew from ${before} to ${after}`;
});

check('only an owner can point QC2GO at a URL', () => {
  // The secret is a credential and the URL decides where a company's data goes.
  const asAdmin = tx(
    ACME_ADMIN,
    `insert into public.webhook_endpoints (org_id, url, secret)
     values ('aaaaaaaa-0000-0000-0000-000000000001', 'https://elsewhere.example/x', 'shh');`,
    { expectError: true },
  );
  return asAdmin?.error ? null : 'an admin registered an endpoint';
});

check('one company cannot read another\'s endpoints or deliveries', () => {
  const endpoints = tx(BETA, `select url from public.webhook_endpoints;`);
  if (endpoints.includes('acme.example')) return 'Beta can read Acme\'s endpoints';
  const deliveries = tx(BETA, `select payload::text from public.webhook_deliveries;`);
  return deliveries.includes('insp-hook') ? 'Beta can read Acme\'s deliveries' : null;
});

// ---------------------------------------------------------------------------
// Share links
//
// A row in `report_shares` is a bearer credential: whoever holds the token can
// read the report without an account. That makes this table the one place where
// a policy mistake does not leak data to another company's staff — it leaks a
// key that anybody at all can use. Worth attacking directly.
// ---------------------------------------------------------------------------

check('a share is stamped with the company that made it', () => {
  tx(
    ACME,
    `insert into public.report_shares (inspection_id, token_hash, expires_at, created_by, recipient)
     values ('insp-acme', 'hash-acme-1', now() + interval '7 days', '${ACME}', 'homeowner@example.test');`,
  );
  const org = psql(`select org_id from public.report_shares where token_hash = 'hash-acme-1';`);
  return org === 'aaaaaaaa-0000-0000-0000-000000000001' ? null : `org_id came out as ${org}`;
});

check('THE ONE THAT MATTERS: one company cannot read another\'s share tokens', () => {
  // Even hashed, this list says which reports are live on the internet and to
  // whom they were sent. Reading it across a company boundary is a breach on
  // its own, before anybody tries to use a token.
  const rows = tx(BETA, `select token_hash, coalesce(recipient, '') from public.report_shares;`);
  if (rows.includes('hash-acme-1')) return 'Beta can read Acme\'s share tokens';
  return rows.includes('homeowner@example.test') ? 'Beta can read who Acme shared with' : null;
});

check('a share cannot be created in another company\'s name', () => {
  const forged = tx(
    BETA,
    `insert into public.report_shares (org_id, inspection_id, token_hash, expires_at, created_by)
     values ('aaaaaaaa-0000-0000-0000-000000000001', 'insp-acme', 'hash-forged',
             now() + interval '7 days', '${BETA}');`,
    { expectError: true },
  );
  return forged?.error ? null : 'Beta published a link to an Acme report';
});

check('a share cannot be attributed to somebody else', () => {
  // Who published a link is the first question asked after one turns up
  // somewhere it should not have.
  const misattributed = tx(
    ACME_ADMIN,
    `insert into public.report_shares (inspection_id, token_hash, expires_at, created_by)
     values ('insp-acme', 'hash-misattributed', now() + interval '7 days', '${ACME}');`,
    { expectError: true },
  );
  return misattributed?.error ? null : 'a share was filed under another account\'s name';
});

check('one company cannot revoke another\'s link', () => {
  tx(BETA, `update public.report_shares set revoked_at = now() where token_hash = 'hash-acme-1';`);
  const revoked = psql(
    `select coalesce(revoked_at::text, 'live') from public.report_shares where token_hash = 'hash-acme-1';`,
  );
  return revoked === 'live' ? null : 'Beta took down an Acme report';
});

check('anybody in the company can revoke, not only an owner', () => {
  // A link sent to the wrong address is an emergency. Making somebody find an
  // owner first is how it stays live for another hour.
  tx(ACME_ADMIN, `update public.report_shares set revoked_at = now() where token_hash = 'hash-acme-1';`);
  const revoked = psql(
    `select coalesce(revoked_at::text, 'live') from public.report_shares where token_hash = 'hash-acme-1';`,
  );
  return revoked === 'live' ? 'an admin could not revoke a link' : null;
});

check('a link that never expires cannot be created', () => {
  // A share with no end date is a report published to the internet by accident,
  // and nobody goes back to check.
  const forever = psql(
    `insert into public.report_shares (org_id, inspection_id, token_hash, expires_at, created_by)
     values ('aaaaaaaa-0000-0000-0000-000000000001', 'insp-acme', 'hash-forever',
             now() - interval '1 day', '${ACME}');`,
    { expectError: true },
  );
  if (!forever?.error) return 'a link was created already expired';

  const missing = psql(
    `insert into public.report_shares (org_id, inspection_id, token_hash, created_by)
     values ('aaaaaaaa-0000-0000-0000-000000000001', 'insp-acme', 'hash-null', '${ACME}');`,
    { expectError: true },
  );
  return missing?.error ? null : 'a link was created with no expiry at all';
});

check('deleting an inspection takes its links down with it', () => {
  // Otherwise a record deleted on request stays readable to anybody holding an
  // old link, which is the opposite of what deleting it meant.
  psql(`
    insert into public.inspections (id, org_id, customer_id, snapshot, visit_type, created_by)
    values ('insp-doomed', 'aaaaaaaa-0000-0000-0000-000000000001', 'cust-acme', '{}',
            'site-visit', '${ACME}');
    insert into public.report_shares (org_id, inspection_id, token_hash, expires_at, created_by)
    values ('aaaaaaaa-0000-0000-0000-000000000001', 'insp-doomed', 'hash-doomed',
            now() + interval '7 days', '${ACME}');
    delete from public.inspections where id = 'insp-doomed';`);
  const left = psql(`select count(*) from public.report_shares where token_hash = 'hash-doomed';`);
  return left === '0' ? null : `${left} link(s) outlived the record`;
});

check('an owner can set their own company logo', () => {
  tx(ACME, `update public.organizations set logo = 'data:image/png;base64,AAAA'
             where id = 'aaaaaaaa-0000-0000-0000-000000000001';`);
  const logo = psql(`select coalesce(logo, '(none)') from public.organizations
                      where id = 'aaaaaaaa-0000-0000-0000-000000000001';`);
  return logo === 'data:image/png;base64,AAAA' ? null : `logo is ${logo}`;
});

check('an admin cannot set the company logo', () => {
  tx(ACME_ADMIN, `update public.organizations set logo = 'data:image/png;base64,BBBB'
              where id = 'aaaaaaaa-0000-0000-0000-000000000001';`);
  const logo = psql(`select logo from public.organizations
                      where id = 'aaaaaaaa-0000-0000-0000-000000000001';`);
  return logo === 'data:image/png;base64,AAAA' ? null : 'an admin changed the branding';
});

check('one company cannot rebrand another', () => {
  tx(BETA, `update public.organizations set name = 'Beta Owns This', logo = null
             where id = 'aaaaaaaa-0000-0000-0000-000000000001';`);
  const row = psql(`select name from public.organizations
                     where id = 'aaaaaaaa-0000-0000-0000-000000000001';`);
  return row === 'Acme QC' ? null : `Acme is now called "${row}"`;
});

check('the logo column refuses anything that is not a small image', () => {
  const notAnImage = psql(
    `update public.organizations set logo = 'https://example.com/logo.png'
      where id = 'aaaaaaaa-0000-0000-0000-000000000001';`,
    { expectError: true },
  );
  if (!notAnImage?.error) return 'a bare URL was accepted';

  const tooBig = psql(
    `update public.organizations set logo = 'data:image/png;base64,' || repeat('A', 600000)
      where id = 'aaaaaaaa-0000-0000-0000-000000000001';`,
    { expectError: true },
  );
  return tooBig?.error ? null : 'an oversized logo was accepted';
});

check('a signed-off inspection cannot be rewritten by its author', () => {
  psql(`update public.inspections set status = 'completed' where id = 'insp-acme';`);
  tx(ACME, `update public.inspections set summary_notes = 'edited after signing' where id = 'insp-acme';`);
  const notes = psql(`select coalesce(summary_notes, '') from public.inspections where id = 'insp-acme';`);
  // The Acme user is an owner, and an owner is an admin — so this one is
  // expected to succeed. The check is that it is admin rights doing it.
  return notes === 'edited after signing' ? null : 'an admin could not amend a signed record';
});

check('an inspector cannot rewrite a signed inspection', () => {
  const crew = '55555555-5555-5555-5555-555555555555';
  psql(`
    insert into public.invites (org_id, email, role, invited_by)
    values ('aaaaaaaa-0000-0000-0000-000000000001', 'crew@acme.test', 'inspector', '${ACME}');
    insert into auth.users (id, email) values ('${crew}', 'crew@acme.test');
    update public.inspections set created_by = '${crew}' where id = 'insp-acme';`);
  tx(crew, `update public.inspections set summary_notes = 'crew edit' where id = 'insp-acme';`);
  const notes = psql(`select coalesce(summary_notes, '') from public.inspections where id = 'insp-acme';`);
  return notes === 'edited after signing' ? null : `an inspector amended a signed record: "${notes}"`;
});

// ---------------------------------------------------------------------------
// The other way 0004 runs: over a database that already has a company in it
//
// Everything above started from nothing, which is how a new deployment arrives
// and not how the existing one does. This replays the real path — three
// migrations, a company's worth of data, then the fourth — and checks that the
// data was adopted rather than orphaned.
// ---------------------------------------------------------------------------

console.log('\nBackfill over existing data:\n');

psql('drop schema if exists public cascade; create schema public;');
psql('drop schema if exists auth cascade; drop schema if exists storage cascade;');
psqlFile(join(here, 'supabase-shim.sql'));

// Split at the migration that introduces companies: everything before it is
// the schema as the live database stands today, everything from it onward is
// what this change applies to that.
const TENANCY_MIGRATION = '0004_organizations.sql';
const splitAt = migrations.indexOf(TENANCY_MIGRATION);
if (splitAt < 0) {
  console.log(`FAIL  ${TENANCY_MIGRATION} is missing — the backfill scenario cannot run`);
  process.exit(1);
}

for (const file of migrations.slice(0, splitAt)) {
  psqlFile(join(root, 'supabase', 'migrations', file));
}
psql(`grant all on all tables in schema public to authenticated;
      grant execute on all functions in schema public to authenticated;`);

const LEGACY_ADMIN = '99999999-0000-0000-0000-000000000001';
const LEGACY_CREW = '99999999-0000-0000-0000-000000000002';

psql(`
  insert into auth.users (id, email) values
    ('${LEGACY_ADMIN}', 'boss@gethealthyhome.test'),
    ('${LEGACY_CREW}',  'crew@gethealthyhome.test');
  update public.profiles set role = 'admin' where id = '${LEGACY_ADMIN}';

  insert into public.templates (id, name, built_in, created_by)
  values ('home-performance', 'Home Performance', true, '${LEGACY_ADMIN}');

  insert into public.shared_config (singleton, info_fields) values (true, '[{"id":"legacy"}]');

  insert into public.customers (id, customer_name, address, created_by)
  values ('legacy-cust', 'Existing Customer', '9 Old Road', '${LEGACY_CREW}');

  insert into public.inspections (id, customer_id, template_id, snapshot, visit_type, created_by)
  values ('legacy-insp', 'legacy-cust', 'home-performance', '{}', 'site-visit', '${LEGACY_CREW}');

  insert into public.photos (id, inspection_id, question_id, storage_path, created_by)
  values ('legacy-photo', 'legacy-insp', 'q1', 'legacy-insp/legacy-photo.jpg', '${LEGACY_CREW}');

  insert into storage.objects (bucket_id, name, owner)
  values ('inspection-photos', 'legacy-insp/legacy-photo.jpg', '${LEGACY_CREW}');
`);

check('the tenancy migrations apply to a database with data in it', () => {
  for (const file of migrations.slice(splitAt)) {
    psqlFile(join(root, 'supabase', 'migrations', file));
  }
  return null;
});

check('existing data was adopted into one company', () => {
  const orgs = psql(`select count(distinct org_id) from (
      select org_id from public.customers
      union all select org_id from public.inspections
      union all select org_id from public.photos
      union all select org_id from public.templates
      union all select org_id from public.shared_config
    ) all_rows;`);
  return orgs === '1' ? null : `data landed in ${orgs} organizations`;
});

check('the existing crew came with it', () => {
  const outside = psql(`select count(*) from public.profiles where org_id is null;`);
  return outside === '0' ? null : `${outside} account(s) left without a company`;
});

check('the company has exactly one owner', () => {
  const owners = psql(`select count(*) from public.profiles where role = 'owner';`);
  if (owners !== '1') return `found ${owners} owners`;
  const who = psql(`select email from public.profiles where role = 'owner';`);
  return who === 'boss@gethealthyhome.test' ? null : `the owner is ${who} — expected the admin`;
});

check('photo paths and objects moved together', () => {
  const org = psql(`select id::text from public.organizations limit 1;`);
  const path = psql(`select storage_path from public.photos where id = 'legacy-photo';`);
  const object = psql(`select name from storage.objects where bucket_id = 'inspection-photos';`);
  if (path !== `${org}/legacy-insp/legacy-photo.jpg`) return `row points at ${path}`;
  if (object !== path) return `object is at ${object} but the row says ${path}`;
  return null;
});

check('the backfill is safe to run twice', () => {
  // Re-running the path-rewriting statements must not double the prefix. The
  // guards are `where` clauses, so this exercises them directly.
  const org = psql(`select id::text from public.organizations limit 1;`);
  psql(`
    update storage.objects
       set name = '${org}/' || name
     where bucket_id = 'inspection-photos'
       and (storage.foldername(name))[1] <> '${org}';
    update public.photos
       set storage_path = '${org}/' || storage_path
     where storage_path not like '${org}/%';`);
  const path = psql(`select storage_path from public.photos where id = 'legacy-photo';`);
  return path === `${org}/legacy-insp/legacy-photo.jpg` ? null : `prefix applied twice: ${path}`;
});

check('the old crew can still read their own work', () => {
  const rows = tx(LEGACY_CREW, `select id from public.customers;`);
  return rows === 'legacy-cust' ? null : `sees: ${rows || '(nothing)'}`;
});

console.log(
  failures === 0
    ? '\nAll migration and isolation checks passed.\n'
    : `\n${failures} check(s) failed.\n`,
);
process.exit(failures === 0 ? 0 : 1);
