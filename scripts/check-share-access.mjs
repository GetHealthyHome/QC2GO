/**
 * Who may read a shared report, and what they get.
 *
 * `shared-report` is the only function an anonymous caller reaches, and it runs
 * with the service key — so the usual row-level-security net is not underneath
 * it. Every reason to refuse, and everything a reader is allowed to see, is
 * decided in one pure module precisely so it can be asserted here.
 */
import { build } from 'vite';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const out = mkdtempSync(join(tmpdir(), 'qc-share-'));

await build({
  logLevel: 'error',
  build: {
    lib: {
      entry: new URL('../supabase/functions/shared-report/access.ts', import.meta.url).pathname,
      formats: ['es'],
      fileName: 'access',
    },
    outDir: out,
    emptyOutDir: true,
    minify: false,
  },
});

const a = await import(join(out, 'access.js'));

let failures = 0;
function check(name, fn) {
  try {
    fn();
    console.log(`  ok  ${name}`);
  } catch (error) {
    failures += 1;
    console.log(`FAIL  ${name}\n      ${error.message.split('\n')[0]}`);
  }
}

const NOW = new Date('2026-08-12T12:00:00.000Z');
const live = {
  expires_at: '2026-08-20T00:00:00.000Z',
  revoked_at: null,
  passcode_hash: null,
};

check('a live link is readable', () => {
  assert.equal(a.decideAccess(live, null, NOW).ok, true);
});

check('an expired link is refused', () => {
  const expired = { ...live, expires_at: '2026-08-11T00:00:00.000Z' };
  assert.equal(a.decideAccess(expired, null, NOW).ok, false);
});

check('a link that expires this instant is refused, not admitted', () => {
  // Off-by-one on an expiry is the difference between a report going dark on
  // the day it should and staying up for another one.
  const now = { ...live, expires_at: NOW.toISOString() };
  assert.equal(a.decideAccess(now, null, NOW).ok, false);
});

check('a revoked link is refused even before it expires', () => {
  // Revoking is what somebody does after sending a link to the wrong address.
  // Honouring the expiry over the revocation would make that button decorative.
  const revoked = { ...live, revoked_at: '2026-08-12T11:00:00.000Z' };
  assert.equal(a.decideAccess(revoked, null, NOW).ok, false);
});

check('an unknown token is refused', () => {
  assert.equal(a.decideAccess(null, null, NOW).ok, false);
});

check('an unknown token and an expired one give the same answer', () => {
  // Telling them apart lets somebody with a list of guesses learn which were
  // once real, and no legitimate reader does anything with the difference.
  const unknown = a.decideAccess(null, null, NOW);
  const expired = a.decideAccess({ ...live, expires_at: '2026-01-01T00:00:00.000Z' }, null, NOW);
  assert.equal(unknown.status, expired.status);
  assert.equal(unknown.message, expired.message);
});

check('a passcode-protected link asks rather than refuses', () => {
  const locked = { ...live, passcode_hash: 'abc123' };
  const decision = a.decideAccess(locked, null, NOW);
  assert.equal(decision.ok, false);
  assert.equal(decision.status, 401, 'the reader has to be told to enter one');
});

check('the wrong passcode does not open it', () => {
  const locked = { ...live, passcode_hash: 'abc123' };
  assert.equal(a.decideAccess(locked, 'def456', NOW).ok, false);
});

check('the right passcode does', () => {
  const locked = { ...live, passcode_hash: 'abc123' };
  assert.equal(a.decideAccess(locked, 'abc123', NOW).ok, true);
});

check('a passcode on an expired link still does not open it', () => {
  const locked = { ...live, expires_at: '2026-01-01T00:00:00.000Z', passcode_hash: 'abc123' };
  assert.equal(a.decideAccess(locked, 'abc123', NOW).ok, false);
});

check('digests are compared in constant time', () => {
  assert.equal(a.timingSafeEqual('abc', 'abc'), true);
  assert.equal(a.timingSafeEqual('abc', 'abd'), false);
  assert.equal(a.timingSafeEqual('abc', 'abcd'), false);
  assert.equal(a.timingSafeEqual('', ''), true);
});

// ---------------------------------------------------------------------------
// The record behind the token
// ---------------------------------------------------------------------------

const ORG = 'org-1';
const signed = { status: 'completed', org_id: ORG };

check('a signed report is served', () => {
  assert.equal(a.decideRecord(signed, ORG).ok, true);
});

check('THE REOPEN ONE: a reopened report goes dark until it is signed again', () => {
  // A share is made from a signed report, but signed reports get reopened. While
  // one is open it is a working draft — half-corrected answers, a cleared score,
  // photos being replaced — and a link handed to a homeowner last week must not
  // start showing them that.
  const decision = a.decideRecord({ status: 'in-progress', org_id: ORG }, ORG);
  assert.equal(decision.ok, false);
  assert.match(decision.message, /signed off/i, 'the reader is not told it will come back');
});

check('and the same link works again afterwards', () => {
  // Revoking on reopen would be the easy implementation and the wrong one: the
  // link is not compromised, the record is merely mid-edit.
  assert.equal(a.decideRecord({ status: 'completed', org_id: ORG }, ORG).ok, true);
});

check('a deleted record is refused rather than served empty', () => {
  assert.equal(a.decideRecord(null, ORG).ok, false);
});

check('a share cannot reach across to another company\'s record', () => {
  // This function runs with the service key, so nothing underneath it would
  // notice. It gives the same answer as an unknown token, deliberately.
  const decision = a.decideRecord({ status: 'completed', org_id: 'org-2' }, ORG);
  assert.equal(decision.ok, false);
  assert.equal(decision.status, a.decideAccess(null, null, NOW).status);
  assert.equal(decision.message, a.decideAccess(null, null, NOW).message);
});

// ---------------------------------------------------------------------------

check('THE DISCLOSURE ONE: a reader gets the report and nothing else', () => {
  // An allow-list rather than deleting fields, so a column added later is
  // invisible by default. The first version of anything like this leaks
  // `created_by` and the internal ids of everything the record touches.
  const shaped = a.publicReport({
    inspection: {
      id: 'insp-1',
      org_id: 'org-secret',
      created_by: 'user-secret',
      template_id: 'tpl-secret',
      customer_id: 'cust-secret',
      reopenings: [{ reason: 'we got the permit number wrong', by: 'boss@co.test' }],
      visit_type: 'final-walkthrough',
      responses: { q1: { answer: 'yes' } },
      overall_score: 94,
    },
    customer: { customer_name: 'Dana', address: '1 Road', phone: '555-0100', salesperson: 'R' },
    organization: { name: 'Acme', logo: 'data:image/png;base64,AA', slug: 'acme' },
    photos: [{ id: 'p1', question_id: 'q1', storage_path: 'org/insp/p1.jpg', url: 'https://signed' }],
  });

  const serialised = JSON.stringify(shaped);
  for (const secret of [
    'org-secret',
    'user-secret',
    'tpl-secret',
    'cust-secret',
    'we got the permit number wrong',
    'boss@co.test',
    '555-0100',
    'org/insp/p1.jpg',
  ]) {
    assert.ok(!serialised.includes(secret), `a reader can see ${JSON.stringify(secret)}`);
  }

  // And still gets what the report is actually for.
  assert.equal(shaped.inspection.overallScore, 94);
  assert.equal(shaped.customer.customerName, 'Dana');
  assert.equal(shaped.organization.name, 'Acme');
  assert.equal(shaped.photos[0].url, 'https://signed');
});

check('a photo travels as a signed URL, never as a bucket key', () => {
  const shaped = a.publicReport({
    inspection: { id: 'i' },
    customer: null,
    organization: null,
    photos: [{ id: 'p1', question_id: 'q1', storage_path: 'org/i/p1.jpg', url: 'https://signed' }],
  });
  assert.equal(shaped.photos[0].url, 'https://signed');
  assert.equal(shaped.photos[0].storage_path, undefined);
});

console.log(failures === 0 ? '\nAll share access checks passed.\n' : `\n${failures} FAILED\n`);
process.exit(failures === 0 ? 0 : 1);
