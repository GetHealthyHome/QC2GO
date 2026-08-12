/**
 * The pencil-whipping checks, and — mostly — what they must NOT fire on.
 *
 * A fraud flag is only worth having if a supervisor still reads it in six
 * months. Every false positive spends that credibility, and the ways to
 * generate one here are ordinary: a short re-check visit, an inspection left
 * open overnight, a walk interrupted by lunch, a GPS fix taken in a basement,
 * an inspector who is simply quick.
 *
 * So most of what follows is about silence. The two checks that do fire are
 * marked.
 */
import { build } from 'vite';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const out = mkdtempSync(join(tmpdir(), 'qc-integrity-'));

await build({
  logLevel: 'error',
  build: {
    lib: {
      entry: new URL('../src/lib/integrity.ts', import.meta.url).pathname,
      formats: ['es'],
      fileName: 'integrity',
    },
    outDir: out,
    emptyOutDir: true,
    minify: false,
  },
});

const g = await import(join(out, 'integrity.js'));

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

const START = Date.parse('2026-08-12T09:00:00.000Z');

/** An inspection whose answers are `gaps` seconds apart. */
function walked({ id = 'insp', inspector = 'A. Holcombe', count = 20, gapSeconds = 45, gaps } = {}) {
  const responses = {};
  let time = START;
  for (let i = 0; i < count; i += 1) {
    responses[`q${i}`] = {
      answer: 'yes',
      photoIds: [],
      answeredAt: new Date(time).toISOString(),
    };
    time += (gaps ? gaps[i % gaps.length] : gapSeconds) * 1000;
  }
  return {
    id,
    customerId: 'cust',
    templateId: 'tpl',
    visitType: 'site-visit',
    visitDate: '2026-08-12',
    status: 'completed',
    info: { inspector },
    responses,
    createdAt: new Date(START).toISOString(),
    completedAt: new Date(time).toISOString(),
    updatedAt: new Date(time).toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Measuring the pace
// ---------------------------------------------------------------------------

check('a steady walk measures its own pace', () => {
  assert.equal(g.velocityOf(walked({ gapSeconds: 45 })).medianGapSeconds, 45);
});

check('THE LUNCH ONE: one enormous gap does not hide the pattern', () => {
  // A walk interrupted for forty minutes would drag a mean upward and clear an
  // inspection that was otherwise tapped through in seconds. A median does not
  // notice the interruption at all, which is the whole reason it is a median.
  const interrupted = walked({ count: 21, gaps: [2, 2, 2, 2, 2, 2, 2, 2, 2, 2400] });
  assert.equal(g.velocityOf(interrupted).medianGapSeconds, 2);
});

check('an inspection left open overnight is judged on its answers, not its clock', () => {
  // createdAt to completedAt is fourteen hours here and says nothing.
  const overnight = walked({ count: 12, gapSeconds: 30 });
  overnight.completedAt = '2026-08-12T23:00:00.000Z';
  assert.equal(g.velocityOf(overnight).medianGapSeconds, 30);
});

check('too few answers to judge says so rather than guessing', () => {
  // A three-question re-check is legitimately over in twenty seconds.
  const recheck = walked({ count: 3, gapSeconds: 2 });
  assert.equal(g.velocityOf(recheck).medianGapSeconds, null);
  assert.equal(g.velocityFlag(recheck, null), null, 'a short re-check was flagged');
});

check('answers with no timestamp are not counted as instant', () => {
  // Every inspection signed before `answeredAt` existed has none of them, and
  // reading a missing timestamp as zero would flag the entire back catalogue.
  const old = walked({ count: 20 });
  for (const response of Object.values(old.responses)) delete response.answeredAt;
  assert.equal(g.velocityOf(old).answered, 0);
  assert.equal(g.velocityOf(old).medianGapSeconds, null);
  assert.equal(g.velocityFlag(old, null), null);
});

// ---------------------------------------------------------------------------
// Firing, and not firing
// ---------------------------------------------------------------------------

check('THE ONE IT IS FOR: sixty checkpoints in ninety seconds is flagged', () => {
  const pencilWhipped = walked({ count: 60, gapSeconds: 1.5 });
  const flag = g.velocityFlag(pencilWhipped, null);
  assert.ok(flag, 'not flagged');
  assert.equal(flag.kind, 'velocity');
  assert.match(flag.detail, /1\.5s/);
});

check('an ordinary walk is not flagged', () => {
  assert.equal(g.velocityFlag(walked({ gapSeconds: 45 }), null), null);
});

check('a quick inspector is not flagged for being quick', () => {
  // 8s per checkpoint is fast and perfectly possible on a familiar scope.
  const quick = walked({ count: 30, gapSeconds: 8 });
  const baseline = { medianGapSeconds: 9, sample: 6 };
  assert.equal(g.velocityFlag(quick, baseline), null);
});

check('but the same inspector going three times their own speed is', () => {
  const rushed = walked({ count: 30, gapSeconds: 3 });
  const baseline = { medianGapSeconds: 40, sample: 6 };
  const flag = g.velocityFlag(rushed, baseline);
  assert.ok(flag, 'not flagged');
  assert.match(flag.detail, /normally takes 40s/);
});

check('THE ALWAYS-FAST ONE: a low baseline does not clear somebody forever', () => {
  // An inspector who has always pencil-whipped has a fast baseline, and a
  // pure ratio would compare them against themselves and clear them every time.
  // The absolute floor is what catches it.
  const alwaysFast = walked({ count: 40, gapSeconds: 1.2 });
  const selfBaseline = { medianGapSeconds: 1.3, sample: 20 };
  assert.ok(g.velocityFlag(alwaysFast, selfBaseline), 'cleared by its own bad history');
});

// ---------------------------------------------------------------------------
// The baseline
// ---------------------------------------------------------------------------

const history = [
  walked({ id: 'h1', gapSeconds: 40 }),
  walked({ id: 'h2', gapSeconds: 50 }),
  walked({ id: 'h3', gapSeconds: 45 }),
  walked({ id: 'h4', inspector: 'Someone Else', gapSeconds: 3 }),
];

check('a baseline is built from that inspector alone', () => {
  const baseline = g.baselineFor(history, 'A. Holcombe');
  assert.equal(baseline.sample, 3);
  assert.equal(baseline.medianGapSeconds, 45, 'another inspector leaked into the baseline');
});

check('the inspection being judged is not part of its own standard', () => {
  // Otherwise a fast inspection drags down the very number it is compared to.
  const withSelf = [...history, walked({ id: 'today', gapSeconds: 1 })];
  const baseline = g.baselineFor(withSelf, 'A. Holcombe', 'today');
  assert.equal(baseline.medianGapSeconds, 45);
});

check('a new inspector has no baseline yet', () => {
  // Two inspections is not a pace. Falling back to the absolute floor is the
  // right answer, not inventing a standard from one prior visit.
  assert.equal(g.baselineFor(history.slice(0, 2), 'A. Holcombe'), null);
});

check('an unnamed inspector has no baseline', () => {
  assert.equal(g.baselineFor(history, undefined), null);
  assert.equal(g.baselineFor(history, '   '), null);
});

check('the name is matched regardless of case and padding', () => {
  assert.ok(g.baselineFor(history, '  a. holcombe '));
});

check('an in-progress inspection is not part of anyone\'s baseline', () => {
  const unfinished = walked({ id: 'h5', gapSeconds: 2 });
  unfinished.status = 'in-progress';
  const baseline = g.baselineFor([...history, unfinished], 'A. Holcombe');
  assert.equal(baseline.medianGapSeconds, 45, 'a half-walked record set the standard');
});

// ---------------------------------------------------------------------------
// Photo geofencing
// ---------------------------------------------------------------------------

const site = { lat: 42.4604, lng: -71.3489, capturedAt: '2026-08-12T09:00:00.000Z' };
const customer = { id: 'cust', customerName: 'Dana', address: '118 Marsh Rd', location: site };

const photoAt = (id, lat, lng) => ({ id, inspectionId: 'insp', questionId: 'q1', gps: { lat, lng } });

check('a photo taken at the job is not flagged', () => {
  // A few hundred metres out is ordinary: a fix through a roof or from a
  // basement is routinely that far off.
  assert.equal(
    g.photoDistanceFlag([photoAt('p1', 42.4608, -71.3492)], customer),
    null,
  );
});

check('THE ELSEWHERE ONE: a photo from twelve miles away is flagged', () => {
  const flag = g.photoDistanceFlag([photoAt('p1', 42.6, -71.5)], customer);
  assert.ok(flag, 'not flagged');
  assert.equal(flag.kind, 'photo-distance');
  assert.match(flag.label, /1 photo/);
  assert.match(flag.detail, /mi/);
});

check('the furthest one is the one reported', () => {
  const flag = g.photoDistanceFlag(
    [photoAt('p1', 42.47, -71.36), photoAt('p2', 43.5, -72.5)],
    customer,
  );
  assert.match(flag.label, /2 photos/);
  assert.match(flag.detail, /\b\d{2,}\s*mi/, flag.detail);
});

check('a photo with no coordinates is silent, not suspicious', () => {
  // Most photos in this app are taken indoors, where a fix often never arrives.
  // Flagging that would fire on almost every inspection.
  const noFix = { id: 'p1', inspectionId: 'insp', questionId: 'q1' };
  assert.equal(g.photoDistanceFlag([noFix], customer), null);
});

check('a customer whose location was never captured is silent', () => {
  // "Use my location" is optional and often never tapped. There is nothing to
  // measure against, which is not the same as measuring zero.
  const noSite = { ...customer, location: undefined };
  assert.equal(g.photoDistanceFlag([photoAt('p1', 43.5, -72.5)], noSite), null);
  assert.equal(g.photoDistanceFlag([photoAt('p1', 43.5, -72.5)], undefined), null);
});

// ---------------------------------------------------------------------------

check('the two checks combine, and a clean inspection produces nothing', () => {
  const clean = walked({ id: 'today', gapSeconds: 45 });
  assert.deepEqual(
    g.integrityFlags({
      inspection: clean,
      history,
      photos: [photoAt('p1', 42.4608, -71.3492)],
      customer,
    }),
    [],
  );

  const bad = walked({ id: 'today', gapSeconds: 1.5, count: 40 });
  const flags = g.integrityFlags({
    inspection: bad,
    history,
    photos: [photoAt('p1', 43.5, -72.5)],
    customer,
  });
  assert.deepEqual(flags.map((flag) => flag.kind), ['velocity', 'photo-distance']);
});

check('nothing is written back onto the inspection', () => {
  // Flags are derived on read so a threshold can be improved without rewriting
  // signed records — and so a heuristic that turns out to be wrong has not
  // stamped a permanent accusation onto a QC document.
  const inspection = walked({ id: 'today', gapSeconds: 1 });
  const before = JSON.stringify(inspection);
  g.integrityFlags({ inspection, history, photos: [], customer });
  assert.equal(JSON.stringify(inspection), before);
});

console.log(failures === 0 ? '\nAll integrity checks passed.\n' : `\n${failures} FAILED\n`);
process.exit(failures === 0 ? 0 : 1);
