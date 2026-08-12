/**
 * The annotation geometry.
 *
 * These marks are drawn on a phone and then rendered again in a report on a
 * laptop and again on A4 paper. If the maths drifts, an arrow points at the
 * wrong part of a photo in front of a customer — which is worse than having no
 * arrow, because the photo now asserts something false.
 *
 * Everything here is pure, so it can be checked directly rather than inferred
 * from a screenshot.
 */
import { build } from 'vite';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const out = mkdtempSync(join(tmpdir(), 'qc-annotate-'));

await build({
  logLevel: 'error',
  build: {
    lib: {
      entry: new URL('../src/lib/annotate.ts', import.meta.url).pathname,
      formats: ['es'],
      fileName: 'annotate',
    },
    outDir: out,
    emptyOutDir: true,
    minify: false,
  },
});

const a = await import(join(out, 'annotate.js'));

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

check('a mark is clamped to the image it was drawn on', () => {
  // A finger dragged past the edge must not put a mark outside the photo, where
  // it would render off-screen in the report and look like nothing was drawn.
  assert.deepEqual(a.clampPoint({ x: 1.4, y: -0.3 }), { x: 1, y: 0 });
  assert.deepEqual(a.clampPoint({ x: 0.5, y: 0.5 }), { x: 0.5, y: 0.5 });
});

check('a box is the same rectangle whichever way it was dragged', () => {
  const topLeftFirst = a.rectOf({ x: 0.2, y: 0.3 }, { x: 0.6, y: 0.8 });
  const bottomRightFirst = a.rectOf({ x: 0.6, y: 0.8 }, { x: 0.2, y: 0.3 });
  assert.deepEqual(topLeftFirst, bottomRightFirst);
  // Approximate: these are floats, and 0.6 - 0.2 is not 0.4.
  const close = (actual, expected) =>
    assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} is not ${expected}`);
  close(topLeftFirst.x, 0.2);
  close(topLeftFirst.y, 0.3);
  close(topLeftFirst.width, 0.4);
  close(topLeftFirst.height, 0.5);
});

check('coordinates scale to whatever size the image renders at', () => {
  // The same stored mark, drawn into a thumbnail and into a print-size frame.
  const points = [
    { x: 0, y: 0 },
    { x: 0.5, y: 0.25 },
  ];
  assert.equal(a.strokePath(points, 100, 80), 'M 0 0 L 50 20');
  assert.equal(a.strokePath(points, 1000, 800), 'M 0 0 L 500 200');
});

check('an arrowhead sits at the pointing end, not the tail', () => {
  const head = a.arrowHead({ x: 0.1, y: 0.5 }, { x: 0.9, y: 0.5 }, 1000, 1000);
  // The middle vertex of the head is the arrow's tip.
  const tip = head.match(/L (\d+(?:\.\d+)?) (\d+(?:\.\d+)?)/);
  assert.ok(tip, `no tip in ${head}`);
  assert.equal(Math.round(Number(tip[1])), 900);
  assert.equal(Math.round(Number(tip[2])), 500);
});

check('a short arrow still gets a visible head', () => {
  // Proportional sizing alone would give a two-pixel head on a short arrow.
  const head = a.arrowHead({ x: 0.5, y: 0.5 }, { x: 0.54, y: 0.5 }, 1000, 1000);
  const numbers = [...head.matchAll(/-?\d+(?:\.\d+)?/g)].map(Number);
  const spread = Math.max(...numbers) - Math.min(...numbers);
  assert.ok(spread > 20, `arrowhead spanned only ${spread}`);
});

check('a straight stroke collapses to its two ends', () => {
  // Pointer events arrive faster than a finger moves, so a straight drag
  // produces hundreds of points that all say the same nothing.
  const dense = Array.from({ length: 400 }, (_, i) => ({ x: i / 400, y: 0.5 }));
  const thin = a.simplify(dense);
  assert.equal(thin.length, 2, `kept ${thin.length} of ${dense.length}`);
  assert.deepEqual(thin[0], dense[0]);
  assert.deepEqual(thin[thin.length - 1], dense[dense.length - 1]);
});

check('a stroke that actually turns keeps its corners', () => {
  // The other half of the trade: thinning must not straighten out a circle
  // somebody drew around a defect.
  const circle = Array.from({ length: 200 }, (_, i) => {
    const angle = (i / 200) * Math.PI * 2;
    return { x: 0.5 + 0.3 * Math.cos(angle), y: 0.5 + 0.3 * Math.sin(angle) };
  });
  const thin = a.simplify(circle);
  assert.ok(thin.length > 8, `a circle was flattened to ${thin.length} points`);
  assert.ok(thin.length < circle.length / 2, `kept ${thin.length} of ${circle.length}`);

  // Every dropped point still sits close to the kept outline — measured against
  // the *segments* of the simplified polyline, not its corners. On a curve the
  // arc between two kept corners is legitimately far from either of them, and
  // what the algorithm actually guarantees is closeness to the line between.
  const toSegment = (point, from, to) => {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const lengthSquared = dx * dx + dy * dy;
    if (lengthSquared === 0) return Math.hypot(point.x - from.x, point.y - from.y);
    const along = Math.min(
      1,
      Math.max(0, ((point.x - from.x) * dx + (point.y - from.y) * dy) / lengthSquared),
    );
    return Math.hypot(point.x - (from.x + along * dx), point.y - (from.y + along * dy));
  };
  const strays = circle.filter((point) => {
    let nearest = Infinity;
    for (let i = 0; i < thin.length - 1; i += 1) {
      nearest = Math.min(nearest, toSegment(point, thin[i], thin[i + 1]));
    }
    return nearest > 0.004;
  });
  assert.equal(strays.length, 0, `${strays.length} points drifted off the simplified shape`);
});

check('a two-point stroke survives simplification untouched', () => {
  const points = [
    { x: 0.1, y: 0.1 },
    { x: 0.2, y: 0.2 },
  ];
  assert.deepEqual(a.simplify(points), points);
});

check('a tap is not stored as a zero-length mark', () => {
  const tap = { id: '1', kind: 'arrow', color: 'red', points: [{ x: 0.5, y: 0.5 }, { x: 0.5, y: 0.5 }] };
  assert.equal(a.isDegenerate(tap), true);

  const drag = { id: '2', kind: 'arrow', color: 'red', points: [{ x: 0.2, y: 0.2 }, { x: 0.7, y: 0.6 }] };
  assert.equal(a.isDegenerate(drag), false);
});

check('an empty text label is not stored', () => {
  const blank = { id: '3', kind: 'text', color: 'red', points: [{ x: 0.5, y: 0.5 }], text: '   ' };
  assert.equal(a.isDegenerate(blank), true);

  const labelled = { ...blank, text: 'Rim joist' };
  assert.equal(a.isDegenerate(labelled), false);
});

check('every colour has a value and a meaning', () => {
  for (const name of Object.keys(a.ANNOTATION_COLORS)) {
    assert.match(a.ANNOTATION_COLORS[name], /^#[0-9a-f]{6}$/i, `${name} has no colour`);
    assert.ok(a.COLOR_LABELS[name], `${name} has no label`);
  }
});

console.log(failures === 0 ? '\nAll annotation checks passed.\n' : `\n${failures} FAILED\n`);
process.exit(failures === 0 ? 0 : 1);
