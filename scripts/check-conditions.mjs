/**
 * Conditional checkpoints: what a hidden question is allowed to do.
 *
 * The dangerous direction is not a question failing to appear — somebody notices
 * that in a minute. It is a hidden question still counting: blocking a sign-off
 * nobody can clear because the blocker names a checkpoint that is not on screen,
 * or dragging a score down with an answer to a question that was never asked.
 *
 * The other half is the record. A block that simply vanishes leaves a report a
 * reader cannot audit — a skipped question and a deleted one look identical.
 */
import { build } from 'vite';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const out = mkdtempSync(join(tmpdir(), 'qc-conditions-'));

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

// ---------------------------------------------------------------------------
// A gas-appliance checklist: the case this feature exists for.
// ---------------------------------------------------------------------------

const systemSection = {
  id: 'system',
  title: 'System',
  questions: [
    // Informational: answering No means there is no gas appliance, which is a
    // fact about the job and not a deficiency to be photographed.
    { id: 'has-gas', text: 'Gas-fired appliance on site', informational: true },
    { id: 'pad', text: 'Pad level' },
  ],
};

const combustionSection = {
  id: 'combustion',
  title: 'Combustion safety',
  showIf: { questionId: 'has-gas', answerIn: ['yes'] },
  questions: [
    { id: 'c1', text: 'Draft verified', critical: true },
    { id: 'c2', text: 'CO reading within limits', critical: true },
  ],
};

// A single conditional checkpoint rather than a whole section.
const finishSection = {
  id: 'finish',
  title: 'Finish',
  questions: [
    { id: 'f1', text: 'Line hide installed', informational: true },
    { id: 'f2', text: 'Line hide painted', showIf: { questionId: 'f1', answerIn: ['yes'] } },
  ],
};

const sections = [systemSection, combustionSection, finishSection];

function inspection(responses = {}, overrides = {}) {
  return {
    id: 'insp',
    customerId: 'cust',
    templateId: 'tpl',
    visitType: 'site-visit',
    visitDate: '2026-08-12',
    status: 'in-progress',
    info: {},
    responses,
    createdAt: '2026-08-12T09:00:00.000Z',
    updatedAt: '2026-08-12T09:00:00.000Z',
    ...overrides,
  };
}

const yes = { answer: 'yes', photoIds: [] };
const no = { answer: 'no', photoIds: [] };

// ---------------------------------------------------------------------------

check('an unanswered controlling question hides the block', () => {
  // Not the other way round. A checklist that opens with every conditional
  // block showing is exactly as long as one with no conditions in it.
  const blank = inspection();
  const titles = i.expandSections(blank, sections).map((r) => r.section.id);
  assert.deepEqual(titles, ['system', 'finish']);
});

check('answering Yes reveals the section', () => {
  const gas = inspection({ 'has-gas': yes });
  const ids = i.expandSections(gas, sections).map((r) => r.section.id);
  assert.deepEqual(ids, ['system', 'combustion', 'finish']);
});

check('answering No leaves it hidden', () => {
  const electric = inspection({ 'has-gas': no });
  const ids = i.expandSections(electric, sections).map((r) => r.section.id);
  assert.ok(!ids.includes('combustion'), 'twelve combustion questions on an electric job');
});

check('a single checkpoint can be conditional without its section being', () => {
  const notInstalled = inspection({ f1: no });
  const finish = i.expandSections(notInstalled, sections).find((r) => r.section.id === 'finish');
  assert.deepEqual(finish.section.questions.map((q) => q.id), ['f1']);

  const installed = inspection({ f1: yes });
  const revealed = i.expandSections(installed, sections).find((r) => r.section.id === 'finish');
  assert.deepEqual(revealed.section.questions.map((q) => q.id), ['f1', 'f2']);
});

// ---------------------------------------------------------------------------
// THE ONES THAT MATTER: a hidden question must not count
// ---------------------------------------------------------------------------

check('THE DEADLOCK ONE: a hidden question cannot block sign-off', () => {
  // The failure this prevents: a blocker naming a checkpoint that is not on
  // screen, which nobody can clear and which no amount of scrolling explains.
  const electric = inspection({
    'has-gas': no,
    pad: yes,
    f1: no,
    inspectorSignature: undefined,
  }, {
    inspectorSignature: { name: 'A', dataUrl: 'x', signedAt: '2026-08-12T10:00:00.000Z' },
  });
  const blockers = i.completionBlockers(electric, sections, []);
  assert.deepEqual(
    blockers,
    [],
    `unclearable blockers: ${blockers.map((b) => b.label).join(' | ')}`,
  );
});

check('and a visible one still does', () => {
  // The guard above must not have been bought by making blockers toothless.
  const gas = inspection({ 'has-gas': yes, pad: yes, f1: no });
  const blockers = i.completionBlockers(gas, sections, []);
  const labels = blockers.map((b) => b.label);
  assert.ok(labels.includes('Draft verified'), labels.join(' | '));
  assert.ok(labels.includes('CO reading within limits'), labels.join(' | '));
});

check('a hidden question is not counted in progress', () => {
  const electric = inspection({ 'has-gas': no });
  // system: has-gas + pad, finish: f1. Combustion and f2 do not apply.
  assert.equal(i.overallProgress(electric, sections).total, 3);

  const gas = inspection({ 'has-gas': yes });
  assert.equal(i.overallProgress(gas, sections).total, 5);
});

check('THE SCORE ONE: an answer left behind by a hidden block does not score', () => {
  // The inspector answered the combustion questions, then corrected the system
  // type. The answers stay on the record — flipping back must not lose them —
  // but a job with no gas appliance must not be marked down for its draft.
  const changedMind = inspection({
    'has-gas': no,
    pad: yes,
    f1: yes,
    f2: yes,
    c1: no,
    c2: no,
  });
  const score = i.scoreOf(changedMind, sections);
  // pad and f2 — the two scored checkpoints that actually applied. has-gas and
  // f1 are facts, and c1/c2 belong to a section that is not there.
  assert.equal(score.judged, 2, 'the combustion answers were still counted');
  assert.equal(score.passed, 2);
  assert.equal(score.failed, 0);
  assert.equal(score.criticalFailures, 0, 'a critical failure on a system that is not there');
  assert.equal(i.scoreBand(score), 'pass');
});

check('and the answer is still on the record, not deleted', () => {
  // Hiding is not the same as discarding: an inspector who corrects a mistaken
  // answer and corrects it back should not have lost the work in between.
  const changedMind = inspection({ 'has-gas': no, c1: no });
  assert.equal(i.getResponse(changedMind, 'c1').answer, 'no');
});

check('a hidden failure does not become a punch item', () => {
  const changedMind = inspection({ 'has-gas': no, c1: no, c2: yes });
  assert.deepEqual(i.deficiencies(changedMind, sections), []);
});

// ---------------------------------------------------------------------------
// Repeatable sections, which is where the two features meet
// ---------------------------------------------------------------------------

const heads = {
  id: 'heads',
  title: 'Indoor heads',
  repeatable: true,
  instanceNoun: 'Head',
  questions: [
    { id: 'h-pump', text: 'Condensate pump fitted', informational: true },
    {
      id: 'h-pump-test',
      text: 'Pump tested under load',
      showIf: { questionId: 'h-pump', answerIn: ['yes'] },
    },
  ],
};

check('a condition inside a repeatable section is answered per instance', () => {
  // One head has a pump and one does not. The follow-up question has to appear
  // on exactly one of them, which a bare question id could not express.
  const walked = inspection(
    { 'h-pump#i1': yes, 'h-pump#i2': no },
    { sectionInstances: { heads: [{ id: 'i1' }, { id: 'i2' }] } },
  );
  const blocks = i.expandSections(walked, [heads]);
  assert.equal(blocks.length, 2);
  assert.deepEqual(blocks[0].section.questions.map((q) => q.id), ['h-pump', 'h-pump-test']);
  assert.deepEqual(blocks[1].section.questions.map((q) => q.id), ['h-pump']);
});

check('an empty repeatable section that does not apply is not a blocker', () => {
  // Otherwise "add at least one head" is unclearable on a job with no heads.
  const conditionalHeads = {
    ...heads,
    showIf: { questionId: 'has-gas', answerIn: ['yes'] },
  };
  const electric = inspection({ 'has-gas': no, pad: yes });
  const blockers = i.completionBlockers(electric, [systemSection, conditionalHeads], []);
  assert.ok(
    !blockers.some((b) => /add at least one head/i.test(b.label)),
    'asked for a head on a system that has none',
  );
});

// ---------------------------------------------------------------------------
// The record
// ---------------------------------------------------------------------------

check('THE AUDIT ONE: the report says what was skipped and why', () => {
  // A block that simply vanishes leaves a report nobody can audit: a year later
  // a skipped question and a deleted one look identical — absent.
  const electric = inspection({ 'has-gas': no, f1: no });
  const skipped = i.skippedBlocks(electric, sections);

  const section = skipped.find((s) => s.key === 'combustion');
  assert.ok(section, `combustion not listed: ${JSON.stringify(skipped)}`);
  assert.equal(section.kind, 'section');
  assert.equal(section.label, 'Combustion safety');
  assert.match(section.reason, /Gas-fired appliance on site/);
  assert.match(section.reason, /No/, `the answer is not stated: ${section.reason}`);

  const question = skipped.find((s) => s.label === 'Line hide painted');
  assert.ok(question, 'the conditional checkpoint was not listed');
  assert.equal(question.kind, 'question');
});

check('nothing is listed as skipped when everything applied', () => {
  const gas = inspection({ 'has-gas': yes, f1: yes });
  assert.deepEqual(i.skippedBlocks(gas, sections), []);
});

check('a section hidden by an unanswered question says so', () => {
  const blank = inspection();
  const reason = i.skippedBlocks(blank, sections).find((s) => s.key === 'combustion').reason;
  assert.match(reason, /not answered/i, reason);
});

// ---------------------------------------------------------------------------
// Compatibility
// ---------------------------------------------------------------------------

check('THE COMPATIBILITY ONE: a checklist with no conditions is untouched', () => {
  // Every template shipped today has no conditions at all, and every inspection
  // signed before today was scored without them.
  const plain = [systemSection, finishSection].map((s) => ({
    ...s,
    questions: s.questions.map(({ showIf: _showIf, ...q }) => q),
  }));
  const walked = inspection({ 'has-gas': yes, pad: yes, f1: yes, f2: yes });

  assert.equal(i.overallProgress(walked, plain).total, 4);
  assert.equal(i.scoreOf(walked, plain).percent, 100);
  assert.deepEqual(i.skippedBlocks(walked, plain), []);
  // And the section object is handed back as-is rather than copied, so nothing
  // re-renders for a checklist that has no conditions in it.
  assert.equal(i.expandSections(walked, plain)[0].section, plain[0]);
});

check('an unknown controlling question hides rather than crashes', () => {
  // A checkpoint deleted from a checklist while a condition still points at it.
  const orphaned = [
    { ...finishSection, questions: [{ id: 'x', text: 'Orphan', showIf: { questionId: 'gone', answerIn: ['yes'] } }] },
  ];
  const blank = inspection();
  assert.equal(i.expandSections(blank, orphaned)[0].section.questions.length, 0);
  // The signature blocker is always there; what must not be is one naming a
  // checkpoint whose controlling question no longer exists to be answered.
  const blockers = i.completionBlockers(blank, orphaned, []);
  assert.deepEqual(
    blockers.map((blocker) => blocker.kind),
    ['signature'],
    blockers.map((blocker) => blocker.label).join(' | '),
  );
});

console.log(failures === 0 ? '\nAll conditional-logic checks passed.\n' : `\n${failures} FAILED\n`);
process.exit(failures === 0 ? 0 : 1);
