/**
 * What the photo sweeper is allowed to delete.
 *
 * This is the only code in QC2GO that destroys evidence, and there is no undo
 * and no second copy on the server. So almost every case below is a case where
 * it must NOT delete: a file still on its way up, a file whose row it could not
 * look up, a bucket that suddenly looks entirely orphaned.
 *
 * The one case where it does delete is marked.
 */
import { build } from 'vite';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const out = mkdtempSync(join(tmpdir(), 'qc-sweep-'));

await build({
  logLevel: 'error',
  build: {
    lib: {
      entry: new URL('../supabase/functions/sweep-photos/sweep.ts', import.meta.url).pathname,
      formats: ['es'],
      fileName: 'sweep',
    },
    outDir: out,
    emptyOutDir: true,
    minify: false,
  },
});

const s = await import(join(out, 'sweep.js'));

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
const daysAgo = (days) => new Date(NOW.getTime() - days * 86_400_000).toISOString();

const object = (path, days) => ({ path, createdAt: daysAgo(days) });
const known = (...paths) => ({ ok: true, paths: new Set(paths) });

// ---------------------------------------------------------------------------

check('THE ONE IT IS FOR: an old file with no row is collected', () => {
  const decision = s.decideSweep({
    objects: [object('org/insp/live.jpg', 30), object('org/insp/orphan.jpg', 30)],
    known: known('org/insp/live.jpg'),
    now: NOW,
  });
  assert.deepEqual(decision.collect, ['org/insp/orphan.jpg']);
  assert.equal(decision.kept.referenced, 1);
});

check('a file a row points at is never collected, however old', () => {
  const decision = s.decideSweep({
    objects: [object('org/insp/p1.jpg', 3650)],
    known: known('org/insp/p1.jpg'),
    now: NOW,
  });
  assert.deepEqual(decision.collect, []);
});

check('THE IN-FLIGHT ONE: a file uploaded an hour ago is left alone', () => {
  // Bytes go up before the row does, so a photo being synced right now has no
  // row by definition. Collecting it would delete a photo mid-upload.
  const decision = s.decideSweep({
    objects: [{ path: 'org/insp/new.jpg', createdAt: new Date(NOW.getTime() - 3_600_000).toISOString() }],
    known: known(),
    now: NOW,
  });
  assert.deepEqual(decision.collect, []);
  assert.equal(decision.kept.tooRecent, 1);
});

check('and so is one from three days ago, still inside the grace period', () => {
  // A device can be offline for days with an outbox entry still pending.
  const decision = s.decideSweep({
    objects: [object('org/insp/pending.jpg', 3)],
    known: known(),
    now: NOW,
  });
  assert.deepEqual(decision.collect, []);
});

check('THE CATASTROPHIC ONE: a failed lookup deletes nothing', () => {
  // The bug this exists to prevent: a transient database error reading as "no
  // photos exist", which makes every file in the bucket an orphan. An unknown
  // answer is not an empty one.
  const decision = s.decideSweep({
    objects: [object('org/insp/a.jpg', 30), object('org/insp/b.jpg', 30)],
    known: { ok: false, reason: 'connection reset' },
    now: NOW,
  });
  assert.deepEqual(decision.collect, []);
  assert.match(decision.refused, /connection reset/);
});

check('THE CIRCUIT BREAKER: a bucket that looks entirely orphaned is refused', () => {
  // A half-read result set, a renamed column, a path format that changed —
  // each shows up as a suspiciously high orphan rate rather than as an error.
  // A genuine orphan rate is a rounding error.
  const objects = Array.from({ length: 20 }, (_, i) => object(`org/insp/p${i}.jpg`, 30));
  const decision = s.decideSweep({ objects, known: known('org/insp/p0.jpg'), now: NOW });
  assert.deepEqual(decision.collect, []);
  assert.match(decision.refused, /too many to be genuine orphans/i);
});

check('a normal orphan rate is not refused', () => {
  const objects = Array.from({ length: 20 }, (_, i) => object(`org/insp/p${i}.jpg`, 30));
  const referenced = objects.slice(1).map((entry) => entry.path);
  const decision = s.decideSweep({ objects, known: known(...referenced), now: NOW });
  assert.deepEqual(decision.collect, ['org/insp/p0.jpg']);
});

check('a small bucket is not held hostage by the circuit breaker', () => {
  // One orphan in a bucket of two is 50% and entirely ordinary on a young
  // deployment. A safety valve that never opens for a small company is a wall.
  const decision = s.decideSweep({
    objects: [object('org/insp/live.jpg', 30), object('org/insp/orphan.jpg', 30)],
    known: known('org/insp/live.jpg'),
    now: NOW,
  });
  assert.deepEqual(decision.collect, ['org/insp/orphan.jpg']);
  assert.equal(decision.refused, undefined);
});

check('an empty bucket is not a suspicious bucket', () => {
  const decision = s.decideSweep({ objects: [], known: known(), now: NOW });
  assert.deepEqual(decision.collect, []);
  assert.equal(decision.refused, undefined);
});

check('recent files do not count toward the circuit breaker', () => {
  // A fresh deployment is almost entirely unreferenced-and-recent, and that is
  // ordinary rather than alarming.
  const objects = Array.from({ length: 20 }, (_, i) => object(`org/insp/p${i}.jpg`, 1));
  const decision = s.decideSweep({ objects, known: known(), now: NOW });
  assert.deepEqual(decision.collect, []);
  assert.equal(decision.refused, undefined, decision.refused);
  assert.equal(decision.kept.tooRecent, 20);
});

check('THE PREFIX ONE: a path is matched exactly, never as a prefix', () => {
  // `p1.jpg` and `p1.jpg.bak` are different files. A prefix test would either
  // keep the wrong one alive or delete the wrong one.
  const decision = s.decideSweep({
    objects: [object('org/insp/p1.jpg.bak', 30), object('org/insp/p1.jpg', 30)],
    known: known('org/insp/p1.jpg'),
    now: NOW,
  });
  assert.deepEqual(decision.collect, ['org/insp/p1.jpg.bak']);
});

check('two companies with the same photo id do not collide', () => {
  // Ids are unique, but the path is what is compared, and a bug that compared
  // only the last segment would delete one company's file for another's row.
  const decision = s.decideSweep({
    objects: [object('org-a/insp/p1.jpg', 30), object('org-b/insp/p1.jpg', 30)],
    known: known('org-a/insp/p1.jpg', 'org-b/insp/p1.jpg'),
    now: NOW,
  });
  assert.deepEqual(decision.collect, []);
});

check('folder placeholders are ignored rather than swept', () => {
  // Deleting one makes a prefix vanish from the dashboard, and it belongs to no
  // photo, so it is neither an orphan nor evidence.
  const decision = s.decideSweep({
    objects: [object('org/insp/.emptyFolderPlaceholder', 900)],
    known: known(),
    now: NOW,
  });
  assert.deepEqual(decision.collect, []);
  assert.equal(decision.kept.tooRecent, 0, 'a placeholder was counted as a real object');
});

check('a timestamp that cannot be read is treated as brand new', () => {
  // Guessing "old" on a date we cannot parse would delete a file to resolve our
  // own uncertainty, which is the wrong direction for this function.
  const decision = s.decideSweep({
    objects: [{ path: 'org/insp/p1.jpg', createdAt: 'not a date' }],
    known: known(),
    now: NOW,
  });
  assert.deepEqual(decision.collect, []);
  assert.equal(decision.kept.tooRecent, 1);
});

check('a single run is bounded, and says what it left behind', () => {
  // Even a mistake that gets past everything above is bounded and visible
  // before it is total.
  const objects = Array.from({ length: 12 }, (_, i) => object(`org/insp/o${i}.jpg`, 30));
  // Enough referenced files that the circuit breaker stays quiet.
  const referenced = Array.from({ length: 40 }, (_, i) => `org/insp/live${i}.jpg`);
  const decision = s.decideSweep({
    objects: [...objects, ...referenced.map((path) => object(path, 30))],
    known: known(...referenced),
    now: NOW,
    maxPerRun: 5,
  });
  assert.equal(decision.collect.length, 5);
  assert.equal(decision.kept.overCap, 7, 'the remainder was dropped silently');
});

check('the grace period is a week, and it is the default', () => {
  assert.equal(s.GRACE_MS, 7 * 24 * 60 * 60 * 1000);
  const decision = s.decideSweep({
    objects: [object('org/insp/p1.jpg', 6), object('org/insp/p2.jpg', 8)],
    known: known('org/insp/keeps-the-breaker-quiet.jpg'),
    now: NOW,
  });
  assert.deepEqual(decision.collect, ['org/insp/p2.jpg']);
});

console.log(failures === 0 ? '\nAll sweep checks passed.\n' : `\n${failures} FAILED\n`);
process.exit(failures === 0 ? 0 : 1);
