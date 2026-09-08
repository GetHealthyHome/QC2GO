/**
 * Who may set whose password.
 *
 * Setting a password is handing over an account outright, and this is the
 * second piece of QC2GO running with the `service_role` key — there is no
 * row-level security underneath it to catch a mistake. So every case it has to
 * refuse is asserted here, above all the ones where a refusal is the only thing
 * standing between an admin and the owner's account.
 */
import { build } from 'vite';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const out = mkdtempSync(join(tmpdir(), 'qc-setpw-'));

await build({
  logLevel: 'error',
  build: {
    lib: {
      entry: new URL('../supabase/functions/set-password/authorize.ts', import.meta.url).pathname,
      formats: ['es'],
      fileName: 'authorize',
    },
    outDir: out,
    emptyOutDir: true,
    minify: false,
  },
});

const { authorizeSetPassword, authorizeCreateMember, validatePassword } = await import(
  join(out, 'authorize.js')
);

// The client keeps its own copy of the password rule so somebody typing a short
// one is told immediately rather than after a round trip. Built here too, so the
// two can be run over the same inputs and compared.
const mirrorOut = mkdtempSync(join(tmpdir(), 'qc-setpw-mirror-'));
await build({
  logLevel: 'error',
  build: {
    lib: {
      entry: new URL('../src/lib/password.ts', import.meta.url).pathname,
      formats: ['es'],
      fileName: 'password',
    },
    outDir: mirrorOut,
    emptyOutDir: true,
    minify: false,
  },
});
const { passwordProblem, generatePassword } = await import(join(mirrorOut, 'password.js'));

const ACME = 'org-acme';
const BETA = 'org-beta';

const owner = { id: 'user-owner', role: 'owner', org_id: ACME };
const admin = { id: 'user-admin', role: 'admin', org_id: ACME };
const inspector = { id: 'user-crew', role: 'inspector', org_id: ACME };
const orphan = { id: 'user-orphan', role: 'inspector', org_id: null };

const tOwner = { id: 'user-owner', email: 'owner@acme.test', role: 'owner', org_id: ACME };
const tOwner2 = { id: 'user-owner-2', email: 'owner2@acme.test', role: 'owner', org_id: ACME };
const tAdmin = { id: 'user-admin', email: 'admin@acme.test', role: 'admin', org_id: ACME };
const tAdmin2 = { id: 'user-admin-2', email: 'admin2@acme.test', role: 'admin', org_id: ACME };
const tCrew = { id: 'user-crew', email: 'crew@acme.test', role: 'inspector', org_id: ACME };
const tRival = { id: 'user-rival', email: 'crew@beta.test', role: 'inspector', org_id: BETA };

const GOOD = 'winter-shed-41';

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

// ---------------------------------------------------------------------------
// The escalation cases — the reason this file exists
// ---------------------------------------------------------------------------

check('an admin may NOT set the owner’s password', () => {
  const decision = authorizeSetPassword(admin, tOwner, { password: GOOD });
  assert.equal(decision.ok, false, 'an admin could have taken over the company');
  assert.equal(decision.status, 403);
});

check('an admin may NOT set another admin’s password', () => {
  const decision = authorizeSetPassword(admin, tAdmin2, { password: GOOD });
  assert.equal(decision.ok, false);
  assert.equal(decision.status, 403);
});

check('an admin MAY reset an inspector — the case this exists for', () => {
  const decision = authorizeSetPassword(admin, tCrew, { password: GOOD });
  assert.equal(decision.ok, true);
  assert.equal(decision.targetId, 'user-crew');
});

check('an admin may set their own password', () => {
  const decision = authorizeSetPassword(admin, tAdmin, { password: GOOD });
  assert.equal(decision.ok, true, 'no rank is crossed by changing your own account');
});

check('an owner may reset anyone in the company', () => {
  for (const target of [tOwner2, tAdmin, tCrew]) {
    const decision = authorizeSetPassword(owner, target, { password: GOOD });
    assert.equal(decision.ok, true, `owner refused for ${target.role}`);
  }
});

check('an inspector may not set anybody’s password, including their own', () => {
  for (const target of [tCrew, tAdmin, tOwner]) {
    const decision = authorizeSetPassword(inspector, target, { password: GOOD });
    assert.equal(decision.ok, false, `an inspector reached ${target.role}`);
    assert.equal(decision.status, 403);
  }
});

// ---------------------------------------------------------------------------
// Company boundaries
// ---------------------------------------------------------------------------

check('an owner may not reach into another company', () => {
  const decision = authorizeSetPassword(owner, tRival, { password: GOOD });
  assert.equal(decision.ok, false);
  // 404 rather than 403: saying "forbidden" would confirm the account exists.
  assert.equal(decision.status, 404);
});

check('a target the caller cannot see is refused', () => {
  const decision = authorizeSetPassword(owner, null, { password: GOOD });
  assert.equal(decision.ok, false);
  assert.equal(decision.status, 404);
});

check('an account with no company can do nothing', () => {
  const decision = authorizeSetPassword(orphan, tCrew, { password: GOOD });
  assert.equal(decision.ok, false);
  assert.equal(decision.status, 403);
});

check('signed out is 401, not 403', () => {
  const decision = authorizeSetPassword(null, tCrew, { password: GOOD });
  assert.equal(decision.ok, false);
  assert.equal(decision.status, 401);
});

// ---------------------------------------------------------------------------
// The password itself
// ---------------------------------------------------------------------------

check('a short password is refused', () => {
  const decision = authorizeSetPassword(owner, tCrew, { password: 'short1' });
  assert.equal(decision.ok, false);
  assert.equal(decision.status, 400);
});

check('a missing or non-string password is refused', () => {
  for (const password of [undefined, null, 42, {}, []]) {
    const decision = authorizeSetPassword(owner, tCrew, { password });
    assert.equal(decision.ok, false, `accepted ${JSON.stringify(password)}`);
  }
});

check('a password past bcrypt’s 72 bytes is refused rather than silently cut', () => {
  assert.equal(validatePassword('a'.repeat(72)), null, '72 bytes is the limit, not over it');
  assert.notEqual(validatePassword('a'.repeat(73)), null);
});

check('length is counted in bytes, because that is what bcrypt truncates', () => {
  // 30 emoji is 30 characters and 120 bytes. Counting characters would let this
  // through, and everything past byte 72 would be quietly ignored.
  assert.notEqual(validatePassword('🔧'.repeat(30)), null);
  // Accented text well inside the limit still works — this is a byte rule, not
  // an ASCII rule.
  assert.equal(validatePassword('crème-brûlée-1985'), null);
});

check('leading or trailing spaces are refused', () => {
  // They survive into the stored password and are then eaten by autofill and
  // phone keyboards, locking somebody out with an invisible character.
  assert.notEqual(validatePassword(' winter-shed-41'), null);
  assert.notEqual(validatePassword('winter-shed-41 '), null);
  assert.equal(validatePassword('winter shed 41'), null, 'inner spaces are fine');
});

check('the first passwords anybody would try are refused', () => {
  for (const password of ['password12', 'Password123', '1234567890', 'qwertyuiop', 'welcome123']) {
    assert.notEqual(validatePassword(password), null, `accepted ${password}`);
  }
});

check('the password cannot be the person’s own address', () => {
  assert.notEqual(validatePassword('crew@acme.test', 'crew@acme.test'), null);
  assert.notEqual(validatePassword('CREW@ACME.TEST', 'crew@acme.test'), null);
});

// ---------------------------------------------------------------------------
// Creating somebody who has no account yet
// ---------------------------------------------------------------------------

check('an owner may add somebody with a password', () => {
  const decision = authorizeCreateMember(owner, {
    email: 'new@acme.test',
    password: GOOD,
    role: 'inspector',
  });
  assert.equal(decision.ok, true);
  assert.equal(decision.orgId, ACME);
});

check('an admin may NOT add somebody — that changes who is on the roster', () => {
  const decision = authorizeCreateMember(admin, { email: 'new@acme.test', password: GOOD });
  assert.equal(decision.ok, false);
  assert.equal(decision.status, 403);
});

check('a request cannot name the company it is adding into', () => {
  const decision = authorizeCreateMember(owner, {
    email: 'new@acme.test',
    password: GOOD,
    org_id: BETA,
    orgId: BETA,
  });
  assert.equal(decision.ok, true);
  assert.equal(decision.orgId, ACME, 'the company came from the request, not the caller');
});

check('the role defaults to inspector', () => {
  const decision = authorizeCreateMember(owner, { email: 'new@acme.test', password: GOOD });
  assert.equal(decision.role, 'inspector');
});

check('an unknown role is refused', () => {
  const decision = authorizeCreateMember(owner, {
    email: 'new@acme.test',
    password: GOOD,
    role: 'superuser',
  });
  assert.equal(decision.ok, false);
  assert.equal(decision.status, 400);
});

check('addresses are normalised so the unique index sees one form', () => {
  const decision = authorizeCreateMember(owner, {
    email: '  New@ACME.test ',
    password: GOOD,
  });
  assert.equal(decision.email, 'new@acme.test');
});

check('malformed addresses are refused', () => {
  for (const email of ['', '   ', 'crew', 'crew@', '@acme.test', 'crew@acme', 'a b@acme.test', null, 42]) {
    const decision = authorizeCreateMember(owner, { email, password: GOOD });
    assert.equal(decision.ok, false, `accepted ${JSON.stringify(email)}`);
    assert.equal(decision.status, 400);
  }
});

check('a name is trimmed and bounded', () => {
  const decision = authorizeCreateMember(owner, {
    email: 'new@acme.test',
    password: GOOD,
    fullName: `  ${'x'.repeat(400)}  `,
  });
  assert.equal(decision.fullName.length, 120);
});

// ---------------------------------------------------------------------------
// The client mirror has to agree with the server
//
// The server is the authority and refuses regardless. But a mirror that drifts
// is worse than no mirror: it either accepts something the server will refuse —
// so the form looks fine and the save fails for no visible reason — or refuses
// something perfectly good, and nobody can work out why.
// ---------------------------------------------------------------------------

check('the client mirror agrees with the server on every case', () => {
  const cases = [
    ['', undefined],
    ['short1', undefined],
    ['winter-shed-41', undefined],
    ['a'.repeat(72), undefined],
    ['a'.repeat(73), undefined],
    ['🔧'.repeat(30), undefined],
    ['crème-brûlée-1985', undefined],
    [' winter-shed-41', undefined],
    ['winter-shed-41 ', undefined],
    ['winter shed 41', undefined],
    ['password12', undefined],
    ['Password123', undefined],
    ['1234567890', undefined],
    ['crew@acme.test', 'crew@acme.test'],
    ['CREW@ACME.TEST', 'crew@acme.test'],
    ['winter-shed-41', 'crew@acme.test'],
    [null, undefined],
    [42, undefined],
  ];
  for (const [password, email] of cases) {
    const server = validatePassword(password, email);
    const client = passwordProblem(password, email);
    assert.equal(
      client,
      server,
      `disagreed on ${JSON.stringify(password)}: server ${JSON.stringify(server)}, client ${JSON.stringify(client)}`,
    );
  }
});

check('every generated password passes the server’s own rule', () => {
  // A generator that produces something the server refuses would be a dead
  // "Suggest" button — it fills the field and then the save fails.
  const seen = new Set();
  for (let i = 0; i < 500; i += 1) {
    const password = generatePassword();
    assert.equal(validatePassword(password), null, `generated a refused password: ${password}`);
    seen.add(password);
  }
  // Not a randomness test, just a smoke alarm for a generator returning a
  // constant — which would hand every new hire the same password.
  assert.ok(seen.size > 400, `only ${seen.size} distinct passwords in 500 draws`);
});

console.log(
  failures === 0 ? '\nAll set-password authorization checks passed.\n' : `\n${failures} FAILED\n`,
);
process.exit(failures === 0 ? 0 : 1);
