/**
 * What a suggested checkpoint is not allowed to become.
 *
 * `ai-scribe` could be checked against the note the inspector typed. A proposed
 * checkpoint has no original at all, so almost everything below is a case that
 * must be REFUSED — chiefly a suggestion that arrives carrying a threshold.
 * "Verify static pressure is below 0.5 in. w.c." is a company standard turning
 * up in a company's checklist with nobody's decision behind it, and the
 * inspector who meets it in the field will score somebody's work against it.
 *
 * The ones that must be ACCEPTED are marked, and they matter as much: a gate
 * that refuses everything is a feature that does not ship.
 *
 * None of this calls the model.
 */
import { build } from 'vite';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const out = mkdtempSync(join(tmpdir(), 'qc-checkpoints-'));

await build({
  logLevel: 'error',
  build: {
    lib: {
      entry: new URL('../supabase/functions/ai-checkpoints/restraint.ts', import.meta.url).pathname,
      formats: ['es'],
      fileName: 'restraint',
    },
    outDir: out,
    emptyOutDir: true,
    minify: false,
  },
});

const r = await import(join(out, 'restraint.js'));

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

/** Shorthand: sift one proposal against a brief with no existing checkpoints. */
function one(brief, proposal, existing = []) {
  return r.sift(brief, existing, [proposal]);
}

const BRIEF = 'condensate and drainage on a ductless head';

// ---------------------------------------------------------------------------
// The threshold rule — the reason this file exists.
// ---------------------------------------------------------------------------

check('THE THRESHOLD: a suggestion that says what passes is refused', () => {
  const { kept, refused } = one(
    'static pressure testing on a ducted system',
    { text: 'Verify total external static pressure is below 0.5 in. w.c.', kind: 'yesno' },
  );
  assert.equal(kept.length, 0);
  assert.equal(refused.length, 1);
  assert.match(refused[0].reason, /nobody asked for/);
});

check('a minimum is a threshold too', () => {
  const { kept } = one(
    'airflow verification',
    { text: 'Confirm at least 400 CFM per ton of cooling', kind: 'yesno' },
  );
  assert.equal(kept.length, 0);
});

check('a temperature target is a threshold', () => {
  const { kept } = one(BRIEF, { text: 'Check that supply air is 55 degrees or colder', kind: 'yesno' });
  assert.equal(kept.length, 0);
});

check('ACCEPTED: asking for the reading instead of judging it', () => {
  const { kept, refused } = one(
    'static pressure testing on a ducted system',
    { text: 'Record the measured total external static pressure', kind: 'measurement', unit: 'in. w.c.' },
  );
  assert.equal(refused.length, 0);
  assert.equal(kept.length, 1);
  assert.equal(kept[0].kind, 'measurement');
  assert.equal(kept[0].unit, 'in. w.c.');
});

check("ACCEPTED: a number the admin themselves wrote may be repeated", () => {
  // The company chose this one. Repeating it is not inventing it.
  const brief = 'insulation depth in an attic specified at R-49';
  const { kept, refused } = one(brief, { text: 'Confirm attic insulation reaches R-49', kind: 'yesno' });
  assert.equal(refused.length, 0, refused[0]?.reason);
  assert.equal(kept.length, 1);
});

check('an invented model number is refused like an invented threshold', () => {
  const { kept } = one(BRIEF, { text: 'Confirm the MSZ-FH15NA trap is primed', kind: 'yesno' });
  assert.equal(kept.length, 0);
});

check('an invented code reference is refused', () => {
  const { kept } = one(BRIEF, { text: 'Confirm the trap meets IRC M1411.3', kind: 'yesno' });
  assert.equal(kept.length, 0);
});

check('a threshold hidden in the help text is refused too', () => {
  const { kept } = one(BRIEF, {
    text: 'Check the condensate trap depth',
    help: 'Should be at least 2 in. deeper than the blower static',
    kind: 'yesno',
  });
  assert.equal(kept.length, 0);
});

check('ACCEPTED: an ordinary yes/no checkpoint with no numbers at all', () => {
  const { kept, refused } = one(BRIEF, {
    text: 'Is the condensate line sloped continuously to the drain?',
    help: 'No sags or upward runs between the head and the termination.',
    kind: 'yesno',
  });
  assert.equal(refused.length, 0);
  assert.equal(kept.length, 1);
  assert.equal(kept[0].help, 'No sags or upward runs between the head and the termination.');
});

// ---------------------------------------------------------------------------
// Not asking the same thing twice.
// ---------------------------------------------------------------------------

check('a checkpoint already in the section is refused', () => {
  const existing = r.existingKeys(['Is the condensate trap primed?']);
  const { kept, refused } = one(BRIEF, { text: 'Is the condensate trap primed?', kind: 'yesno' }, existing);
  assert.equal(kept.length, 0);
  assert.match(refused[0].reason, /already in this section/);
});

check('THE REWORDING: the same question asked differently is still a duplicate', () => {
  const existing = r.existingKeys(['Is the condensate trap primed?']);
  const { kept } = one(BRIEF, { text: 'Verify the trap is primed', kind: 'yesno' }, existing);
  assert.equal(kept.length, 0);
});

check('and a duplicate inside one batch is refused once', () => {
  const { kept, refused } = r.sift(BRIEF, [], [
    { text: 'Is the drain line sloped to the termination?', kind: 'yesno' },
    { text: 'Confirm drain line slopes to termination', kind: 'yesno' },
  ]);
  assert.equal(kept.length, 1);
  assert.equal(refused.length, 1);
});

// ---------------------------------------------------------------------------
// Shape. A malformed suggestion is dropped, never repaired into something.
// ---------------------------------------------------------------------------

check('a suggestion with no text is dropped', () => {
  assert.equal(r.sift(BRIEF, [], [{ kind: 'yesno' }]).kept.length, 0);
  assert.equal(r.sift(BRIEF, [], [{ text: '   ', kind: 'yesno' }]).kept.length, 0);
});

check('a checkpoint the length of a paragraph is dropped', () => {
  const { kept } = one(BRIEF, { text: 'x'.repeat(r.MAX_TEXT + 1), kind: 'yesno' });
  assert.equal(kept.length, 0);
});

check('THE STRAY LABEL: a unit on a yes/no question is dropped', () => {
  // It would render as a unit beside an answer that has no value to label.
  const { kept } = one(BRIEF, { text: 'Is the trap primed?', kind: 'yesno', unit: 'in' });
  assert.equal(kept.length, 1);
  assert.equal(kept[0].unit, undefined);
});

check('an unrecognised kind becomes a yes/no rather than a guess', () => {
  const { kept } = one(BRIEF, { text: 'Is the trap primed?', kind: 'slider' });
  assert.equal(kept[0].kind, 'yesno');
});

check('POLICY IS NOT THE MODEL’S: critical never arrives switched on', () => {
  const { kept } = one(BRIEF, {
    text: 'Is the trap primed?',
    kind: 'yesno',
    critical: true,
    photoOnPass: true,
    informational: true,
  });
  assert.equal(kept.length, 1);
  assert.equal(kept[0].critical, undefined);
  assert.equal(kept[0].photoOnPass, undefined);
  assert.equal(kept[0].informational, undefined);
});

check('over-long help is trimmed rather than the checkpoint discarded', () => {
  const { kept } = one(BRIEF, { text: 'Is the trap primed?', kind: 'yesno', help: 'y'.repeat(r.MAX_HELP + 50) });
  assert.equal(kept[0].help.length, r.MAX_HELP);
});

check('THE FLOOD: more suggestions than anybody will read one at a time', () => {
  const many = Array.from({ length: r.MAX_SUGGESTIONS + 4 }, (_, i) => ({
    text: `Is component number ${'x'.repeat(i + 1)} secured?`,
    kind: 'yesno',
  }));
  assert.equal(r.sift(BRIEF, [], many).kept.length, r.MAX_SUGGESTIONS);
});

check('anything that is not a list of objects yields nothing', () => {
  assert.equal(r.sift(BRIEF, [], undefined).kept.length, 0);
  assert.equal(r.sift(BRIEF, [], 'checkpoints').kept.length, 0);
  assert.equal(r.sift(BRIEF, [], [null, 42, 'text']).kept.length, 0);
});

// ---------------------------------------------------------------------------
// The description that starts it.
// ---------------------------------------------------------------------------

check('THE INVENTION FLOOR: too little description is refused before the call', () => {
  assert.equal(r.acceptBrief('drains').ok, false);
  assert.equal(r.acceptBrief(undefined).ok, false);
  assert.equal(r.acceptBrief('x'.repeat(r.MAX_BRIEF + 1)).ok, false);
});

check('an ordinary description is sendable, and trimmed', () => {
  const decision = r.acceptBrief(`  ${BRIEF}  `);
  assert.equal(decision.ok, true);
  assert.equal(decision.brief, BRIEF);
});

check('the existing list tolerates whatever the client sent', () => {
  assert.deepEqual(r.existingKeys(undefined), []);
  assert.deepEqual(r.existingKeys([1, null, '']), []);
  assert.equal(r.existingKeys(['Is the trap primed?']).length, 1);
});

// ---------------------------------------------------------------------------
// The instruction the model is given.
// ---------------------------------------------------------------------------

check('the prompt forbids the thing the gate is checking for', () => {
  // Weak on its own. It is here so the instruction and the enforcement cannot
  // drift apart unnoticed — loosen one, and this is the second place to look.
  assert.match(r.SYSTEM_PROMPT, /threshold/i);
  assert.match(r.SYSTEM_PROMPT, /no number at all unless/i);
  assert.match(r.SYSTEM_PROMPT, /already in the section/i);
});

console.log(failures === 0 ? '\nAll checkpoint checks passed.\n' : `\n${failures} FAILED\n`);
process.exit(failures === 0 ? 0 : 1);
