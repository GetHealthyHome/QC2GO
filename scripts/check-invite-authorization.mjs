/**
 * Who may invite whom.
 *
 * The invite function is the only part of QC2GO that runs with the
 * `service_role` key, which bypasses row-level security entirely. Everywhere
 * else a mistake is caught by a policy; here there is nothing underneath. So
 * the decision is a pure function and every case it has to refuse is asserted
 * here — including the one that matters most, which is that a request cannot
 * name the company it is inviting into.
 */
import { build } from 'vite';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const out = mkdtempSync(join(tmpdir(), 'qc-invite-'));

await build({
  logLevel: 'error',
  build: {
    lib: {
      entry: new URL('../supabase/functions/invite-user/authorize.ts', import.meta.url).pathname,
      formats: ['es'],
      fileName: 'authorize',
    },
    outDir: out,
    emptyOutDir: true,
    minify: false,
  },
});

const { authorizeInvite } = await import(join(out, 'authorize.js'));

const ACME = 'org-acme';
const BETA = 'org-beta';

const owner = { id: 'user-owner', role: 'owner', org_id: ACME };
const admin = { id: 'user-admin', role: 'admin', org_id: ACME };
const inspector = { id: 'user-crew', role: 'inspector', org_id: ACME };
const orphan = { id: 'user-orphan', role: 'inspector', org_id: null };

let failures = 0;
function check(name, fn) {
  try {
    fn();
    console.log(`  ok  ${name}`);
  } catch (error) {
    failures += 1;
    console.log(`FAIL  ${name}\n      ${error.message}`);
  }
}

check('an owner can invite an inspector', () => {
  const decision = authorizeInvite(owner, { email: 'crew@acme.test', role: 'inspector' });
  assert.equal(decision.ok, true);
  assert.equal(decision.orgId, ACME);
  assert.equal(decision.invitedBy, owner.id);
});

check('the role defaults to inspector', () => {
  const decision = authorizeInvite(owner, { email: 'crew@acme.test' });
  assert.equal(decision.role, 'inspector');
});

check('an owner can invite another owner', () => {
  const decision = authorizeInvite(owner, { email: 'partner@acme.test', role: 'owner' });
  assert.equal(decision.ok, true);
  assert.equal(decision.role, 'owner');
});

check('THE IMPORTANT ONE: a request cannot choose its own company', () => {
  // Nothing underneath this function would refuse it — the service key bypasses
  // every policy. If the org were ever read from the body, one company could
  // put a member into another.
  const decision = authorizeInvite(owner, {
    email: 'crew@acme.test',
    role: 'admin',
    org_id: BETA,
    orgId: BETA,
    organization_id: BETA,
  });
  assert.equal(decision.ok, true);
  assert.equal(decision.orgId, ACME, 'the org must come from the caller, not the request');
});

check('an admin cannot invite', () => {
  const decision = authorizeInvite(admin, { email: 'crew@acme.test' });
  assert.equal(decision.ok, false);
  assert.equal(decision.status, 403);
});

check('an inspector cannot invite', () => {
  const decision = authorizeInvite(inspector, { email: 'crew@acme.test' });
  assert.equal(decision.ok, false);
  assert.equal(decision.status, 403);
});

check('an account with no company cannot invite', () => {
  const decision = authorizeInvite(orphan, { email: 'crew@acme.test' });
  assert.equal(decision.ok, false);
  assert.equal(decision.status, 403);
});

check('an unauthenticated caller cannot invite', () => {
  const decision = authorizeInvite(null, { email: 'crew@acme.test' });
  assert.equal(decision.ok, false);
  assert.equal(decision.status, 401);
});

check('a made-up role is refused rather than downgraded', () => {
  // Quietly falling back to `inspector` would mean an owner who typed the wrong
  // thing gets a different outcome from the one they asked for, silently.
  const decision = authorizeInvite(owner, { email: 'crew@acme.test', role: 'superuser' });
  assert.equal(decision.ok, false);
  assert.equal(decision.status, 400);
});

check('addresses are normalised so the unique index sees one form', () => {
  const decision = authorizeInvite(owner, { email: '  Crew@ACME.test ' });
  assert.equal(decision.email, 'crew@acme.test');
});

check('malformed addresses are refused', () => {
  for (const email of ['', '   ', 'crew', 'crew@', '@acme.test', 'crew@acme', 'a b@acme.test', null, 42]) {
    const decision = authorizeInvite(owner, { email });
    assert.equal(decision.ok, false, `accepted ${JSON.stringify(email)}`);
    assert.equal(decision.status, 400);
  }
});

check('an absurdly long address is refused', () => {
  const decision = authorizeInvite(owner, { email: `${'a'.repeat(250)}@acme.test` });
  assert.equal(decision.ok, false);
});

console.log(
  failures === 0 ? '\nAll invite authorization checks passed.\n' : `\n${failures} FAILED\n`,
);
process.exit(failures === 0 ? 0 : 1);
