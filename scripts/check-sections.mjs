/**
 * Repeatable sections: how answers are keyed, scored and blocked.
 *
 * This is the change most able to break records that already exist. Every
 * inspection signed before today has no instances, so every one of its answer
 * keys is a bare question id — and if the keying moved, those records would
 * quietly read as unanswered. Most of what follows is about that.
 */
import { build } from 'vite';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const out = mkdtempSync(join(tmpdir(), 'qc-sections-'));

await build({
  logLevel: 'error',
  build: {
    lib: {
      entry: new URL('../src/lib/inspection.ts', import.meta.url).pathname,
      formats: ['es'],
      fileName: 'inspection',
    },
    outDir: out,
    emptyOutDir: true,
    minify: false,
  },
});

const i = await import(join(out, 'inspection.js'));

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

const plain = {
  id: 'outdoor',
  title: 'Outdoor unit',
  questions: [{ id: 'o1', text: 'Pad level' }],
};

const perHead = {
  id: 'heads',
  title: 'Indoor Heads',
  repeatable: true,
  instanceNoun: 'Head',
  questions: [
    { id: 'h1', text: 'Level' },
    { id: 'h2', text: 'Condensate falls', critical: true },
  ],
};

const sections = [plain, perHead];

function inspection(overrides = {}) {
  return {
    id: 'insp',
    customerId: 'cust',
    templateId: 'tpl',
    visitType: 'site-visit',
    visitDate: '2026-08-12',
    status: 'in-progress',
    info: {},
    responses: {},
    createdAt: '2026-08-12T09:00:00.000Z',
    updatedAt: '2026-08-12T09:00:00.000Z',
    ...overrides,
  };
}

const twoHeads = {
  heads: [
    { id: 'i1', label: 'Primary bedroom' },
    { id: 'i2' },
  ],
};

// ---------------------------------------------------------------------------

check('THE COMPATIBILITY ONE: an old record still reads as answered', () => {
  // Every inspection signed before repeatable sections existed keys its answers
  // by bare question id. If that moved, those records would read as unanswered
  // — a signed report quietly turning blank is the worst outcome available.
  const old = inspection({ responses: { o1: { answer: 'yes', photoIds: [] } } });
  assert.equal(i.getResponse(old, 'o1').answer, 'yes');
  assert.equal(i.responseKey('o1'), 'o1', 'a non-instance key must stay bare');

  const score = i.scoreOf(old, [plain]);
  assert.equal(score.passed, 1);
  assert.equal(score.percent, 100);
});

check('a repeatable section with no instances contributes nothing', () => {
  const blank = inspection();
  const expanded = i.expandSections(blank, sections);
  assert.equal(expanded.length, 1, 'only the plain section should render');
  assert.equal(expanded[0].section.id, 'outdoor');
  assert.equal(i.overallProgress(blank, sections).total, 1);
});

check('each instance becomes its own block, named', () => {
  const walked = inspection({ sectionInstances: twoHeads });
  const expanded = i.expandSections(walked, sections);
  assert.equal(expanded.length, 3, 'the plain section plus two heads');
  assert.equal(expanded[1].title, 'Indoor Heads — Primary bedroom');
  // Unnamed instances fall back to the noun and their position.
  assert.equal(expanded[2].title, 'Indoor Heads — Head 2');
  assert.equal(expanded[1].key, 'heads#i1');
});

check('answers on two heads do not collide', () => {
  // The whole point: failing the same checkpoint on two heads is two facts.
  const walked = inspection({
    sectionInstances: twoHeads,
    responses: {
      o1: { answer: 'yes', photoIds: [] },
      'h1#i1': { answer: 'yes', photoIds: [] },
      'h1#i2': { answer: 'no', note: 'Sloping', photoIds: ['p1'] },
      'h2#i1': { answer: 'yes', photoIds: [] },
      'h2#i2': { answer: 'yes', photoIds: [] },
    },
  });

  assert.equal(i.getResponse(walked, 'h1', 'i1').answer, 'yes');
  assert.equal(i.getResponse(walked, 'h1', 'i2').answer, 'no');

  const score = i.scoreOf(walked, sections);
  assert.equal(score.judged, 5, 'one plain plus two questions on each of two heads');
  assert.equal(score.passed, 4);
  assert.equal(score.failed, 1);
});

check('a critical failure on one head fails the whole inspection', () => {
  const walked = inspection({
    sectionInstances: twoHeads,
    responses: {
      o1: { answer: 'yes', photoIds: [] },
      'h1#i1': { answer: 'yes', photoIds: [] },
      'h1#i2': { answer: 'yes', photoIds: [] },
      'h2#i1': { answer: 'yes', photoIds: [] },
      'h2#i2': { answer: 'no', note: 'Condensate backs up', photoIds: ['p1'] },
    },
  });
  const score = i.scoreOf(walked, sections);
  assert.equal(score.criticalFailures, 1);
  assert.equal(i.scoreBand(score), 'fail', `80% with a critical failure was ${i.scoreBand(score)}`);
});

check('a deficiency says which head it came from', () => {
  const walked = inspection({
    sectionInstances: twoHeads,
    responses: { 'h1#i2': { answer: 'no', note: 'Sloping', photoIds: ['p1'] } },
  });
  const found = i.deficiencies(walked, sections);
  assert.equal(found.length, 1);
  assert.equal(found[0].instanceId, 'i2');
  assert.equal(found[0].sectionTitle, 'Indoor Heads — Head 2');
  assert.equal(found[0].stepKey, 'heads#i2', 'review has to link back to the right step');
});

check('an unanswered question on the second head blocks sign-off', () => {
  const walked = inspection({
    sectionInstances: twoHeads,
    responses: {
      o1: { answer: 'yes', photoIds: [] },
      'h1#i1': { answer: 'yes', photoIds: [] },
      'h2#i1': { answer: 'yes', photoIds: [] },
      // i2 untouched.
    },
  });
  const blockers = i.completionBlockers(walked, sections, []);
  const unanswered = blockers.filter((blocker) => blocker.kind === 'unanswered');
  assert.equal(unanswered.length, 2, 'both questions on the second head');
  assert.ok(
    unanswered.every((blocker) => blocker.label.includes('Head 2')),
    `blockers do not name the head: ${unanswered.map((b) => b.label).join(' | ')}`,
  );
});

check('a repeatable section with nothing added blocks sign-off', () => {
  // Otherwise a five-head job could be signed with no heads inspected at all,
  // and the score would read 100%.
  const blank = inspection({ responses: { o1: { answer: 'yes', photoIds: [] } } });
  const blockers = i.completionBlockers(blank, sections, []);
  assert.ok(
    blockers.some((blocker) => /add at least one head/i.test(blocker.label)),
    `no blocker for the empty section: ${blockers.map((b) => b.label).join(' | ')}`,
  );
});

check('a fully answered repeatable section blocks nothing', () => {
  const walked = inspection({
    sectionInstances: { heads: [{ id: 'i1' }] },
    responses: {
      o1: { answer: 'yes', photoIds: [] },
      'h1#i1': { answer: 'yes', photoIds: [] },
      'h2#i1': { answer: 'na', photoIds: [] },
    },
    inspectorSignature: { name: 'A', dataUrl: 'x', signedAt: '2026-08-12T10:00:00.000Z' },
  });
  assert.deepEqual(i.completionBlockers(walked, sections, []), []);
});

check('progress counts every instance', () => {
  const walked = inspection({
    sectionInstances: twoHeads,
    responses: { o1: { answer: 'yes', photoIds: [] } },
  });
  const progress = i.overallProgress(walked, sections);
  assert.equal(progress.total, 5, 'one plain plus two questions on each of two heads');
  assert.equal(progress.answered, 1);
});

check('per-instance progress is separate', () => {
  const walked = inspection({
    sectionInstances: twoHeads,
    responses: { 'h1#i1': { answer: 'yes', photoIds: [] } },
  });
  assert.equal(i.sectionProgress(walked, perHead, 'i1').answered, 1);
  assert.equal(i.sectionProgress(walked, perHead, 'i2').answered, 0);
});

console.log(failures === 0 ? '\nAll repeatable-section checks passed.\n' : `\n${failures} FAILED\n`);
process.exit(failures === 0 ? 0 : 1);
