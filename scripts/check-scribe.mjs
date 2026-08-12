/**
 * What a tidied-up deficiency note is not allowed to become.
 *
 * The note this feature rewrites is read by the homeowner, quoted on the work
 * order, and attached to a record somebody signs. So almost every case below is
 * a rewrite that must be REFUSED — a measurement quietly dropped, a serial
 * number changed by one character, a "no trap" that comes back as "trap fitted
 * incorrectly". The handful that must be accepted are marked.
 *
 * None of this calls the model. The point of the gate is that it can be
 * asserted, and a check that needed an API key would be a check that nobody
 * runs.
 */
import { build } from 'vite';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const out = mkdtempSync(join(tmpdir(), 'qc-scribe-'));

await build({
  logLevel: 'error',
  build: {
    lib: {
      entry: new URL('../supabase/functions/ai-scribe/fidelity.ts', import.meta.url).pathname,
      formats: ['es'],
      fileName: 'fidelity',
    },
    outDir: out,
    emptyOutDir: true,
    minify: false,
  },
});

const f = await import(join(out, 'fidelity.js'));

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

/** Asserts a rewrite is thrown away, and returns the reason for inspection. */
function refused(original, suggestion) {
  const verdict = f.acceptSuggestion(original, suggestion);
  assert.equal(verdict.ok, false, `this was accepted and should not have been:\n  ${suggestion}`);
  return verdict.reason;
}

function accepted(original, suggestion) {
  const verdict = f.acceptSuggestion(original, suggestion);
  assert.equal(
    verdict.ok,
    true,
    `this was refused and should not have been:\n  ${suggestion}\n  ${verdict.reason ?? ''}`,
  );
  return verdict;
}

// ---------------------------------------------------------------------------
// The rewrite this whole gate exists for.
// ---------------------------------------------------------------------------

check('THE CHANGED ALLEGATION: absent must not become badly done', () => {
  // The one that motivates the feature having a gate at all. Both sentences are
  // grammatical, both are about a condensate trap, and they accuse the
  // installer of two different things. The customer reads the second one.
  const reason = refused(
    'no condensate trap on the ac unit in the attic',
    'The condensate trap on the AC unit in the attic was installed incorrectly.',
  );
  assert.match(reason, /changed what the note says is wrong/i);
});

check('and the other direction, where a fault becomes an absence', () => {
  refused(
    'condensate trap fitted the wrong way round',
    'The condensate trap is missing.',
  );
});

check('THE FAIR REWRITE of the same note is accepted', () => {
  // If the gate refused this too it would be a feature that never fires, and
  // the honest version of that is not shipping it.
  const verdict = accepted(
    'no condensate trap on the ac unit in the attic',
    'There is no condensate trap on the AC unit in the attic.',
  );
  assert.equal(verdict.changed, true);
});

// ---------------------------------------------------------------------------
// Facts must survive, exactly and in both directions.
// ---------------------------------------------------------------------------

check('THE LOST MEASUREMENT: a dropped number is refused', () => {
  const reason = refused(
    'gap of 3/4 in at the sill plate, runs about 6 ft along the south wall',
    'There is a gap at the sill plate running along the south wall.',
  );
  assert.match(reason, /lost something from the original/i);
});

check('THE INVENTED MEASUREMENT: a number nobody wrote is refused', () => {
  const reason = refused(
    'gap at the sill plate along the south wall',
    'There is a 3/4 in gap at the sill plate running about 6 ft along the south wall.',
  );
  assert.match(reason, /added something you did not write/i);
});

check('THE ALTERED SERIAL: one character is enough', () => {
  // A serial that is nearly right is worse than one that is missing: it gets
  // ordered against, and the wrong part arrives.
  refused(
    'compressor serial SN#A4472-B is not the one on the paperwork',
    'The compressor serial SN#A4473-B does not match the paperwork.',
  );
});

check('but tidying the punctuation around a serial is not altering it', () => {
  accepted(
    'compressor serial SN#A4472-B is not the one on the paperwork',
    'The compressor serial number, SN A4472-B, does not match the paperwork.',
  );
});

check('THE CHANGED UNIT: 12 in and 12 ft are different findings', () => {
  // The digits are identical, so anything comparing only numbers lets this
  // through — and a foot of missing clearance is a different report.
  refused(
    'only 12 in of clearance above the flue',
    'There is only 12 ft of clearance above the flue.',
  );
});

check('while the same measurement written another way is the same fact', () => {
  accepted('only 12in clearance above the flue', 'There is only 12 inches of clearance above the flue.');
  accepted('gap is 3/4" wide', 'The gap is 3/4 in wide.');
  accepted('reading was 1,200 cfm', 'The reading was 1200 CFM.');
  accepted('supply temp 72 °F at the register', 'The supply temperature is 72 F at the register.');
});

check('a rating is a fact: R-13 must not come back as R-19', () => {
  refused('R-13 batts in a wall that calls for R-19', 'R-19 batts in a wall that calls for R-13.');
});

check('THE SILENT ROUNDING: 3.5 must not become 4', () => {
  refused('deflection of 3.5 in across the span', 'There is a deflection of 4 in across the span.');
});

check('but a trailing zero is not a different number', () => {
  accepted('deflection of 3.50 in across the span', 'There is a deflection of 3.5 in across the span.');
});

check('a repeated measurement may be said once', () => {
  // Removing the second mention of the same 40 gal is tidying, not losing a
  // fact — which is why the comparison is a set and not a tally.
  accepted(
    'water heater is 40 gal, the 40 gal tank is leaking at the base',
    'The 40 gal water heater tank is leaking at the base.',
  );
});

// ---------------------------------------------------------------------------
// The fact extractor itself, asserted directly.
// ---------------------------------------------------------------------------

check('what counts as a fact', () => {
  assert.deepEqual([...f.facts('12 in of clearance')], ['12 in']);
  assert.deepEqual([...f.facts('12in of clearance')], ['12 in']);
  assert.deepEqual([...f.facts('gap is 3/4"')], ['3/4 in']);
  assert.deepEqual([...f.facts('reading 1,200 cfm')], ['1200 cfm']);
  assert.deepEqual([...f.facts('at 3:30 today')], ['3:30']);
  assert.deepEqual([...f.facts('serial A4472B')], ['#a4472b']);
});

check('ordinary prose has no facts in it to preserve', () => {
  // Otherwise every rewrite of an ordinary sentence would be compared on
  // nothing and the gate would be decorative.
  assert.deepEqual(f.facts('the flue is loose where it meets the collar'), []);
});

// ---------------------------------------------------------------------------
// Polarity.
// ---------------------------------------------------------------------------

check('a denial is recognised however it is phrased', () => {
  for (const text of [
    'no trap fitted',
    'the trap is missing',
    'trap is absent',
    "there isn't a trap",
    'trap was never fitted',
    'installed without a trap',
    'the unit fails to drain',
  ]) {
    assert.equal(f.denies(text), true, `not read as a denial: ${text}`);
  }
});

check('THE WORD INSIDE A WORD: "note" does not contain a denial', () => {
  // A substring match here would mark almost every sentence as a denial and
  // the polarity check would pass everything by accident.
  assert.equal(f.denies('noted the nominal reading on the northern unit'), false);
  assert.equal(f.denies('the trap drains to the pan'), false);
  // And at the end of a word as well as the start: the boundary is needed on
  // both sides or "piano" is a denial.
  assert.equal(f.denies('the piano is against the outside wall'), false);
});

check('"model no. 4472" is a part number, not a denial', () => {
  // Common enough in this trade that reading it as a negative would refuse a
  // good rewrite of half the notes that name a part.
  assert.equal(f.denies('water heater model no. 4472 installed 2019'), false);
  assert.equal(f.denies('serial no 88B on the outdoor unit'), false);
  accepted(
    'water heater model no. 4472, tank leaking at the base',
    'The water heater, model no. 4472, has a tank leaking at the base.',
  );
  // ...but the plain word still is one.
  assert.equal(f.denies('no drain pan under the water heater'), true);
});

check('merging two negative sentences into one is still a denial', () => {
  accepted(
    'no trap. also no pan under the unit',
    'There is no condensate trap and no pan under the unit.',
  );
});

// ---------------------------------------------------------------------------
// Shape of what comes back.
// ---------------------------------------------------------------------------

check('THE ESSAY: a rewrite twice the length is not a rewrite', () => {
  const reason = refused(
    'flue loose at the collar',
    'The flue pipe is loose where it meets the collar. This is a safety concern because a loose flue can allow combustion gases to enter the living space, and it should be secured by a qualified technician at the earliest opportunity.',
  );
  assert.match(reason, /added more than it tidied/i);
});

check('a code fence or a pair of quotes is stripped, not pasted into the report', () => {
  assert.equal(
    accepted('flue loose at the collar', '```\nThe flue is loose at the collar.\n```').text,
    'The flue is loose at the collar.',
  );
  assert.equal(
    accepted('flue loose at the collar', '"The flue is loose at the collar."').text,
    'The flue is loose at the collar.',
  );
});

check('nothing usable is a refusal, not an empty suggestion', () => {
  assert.equal(f.acceptSuggestion('flue loose at the collar', '').ok, false);
  assert.equal(f.acceptSuggestion('flue loose at the collar', '   ').ok, false);
  assert.equal(f.acceptSuggestion('flue loose at the collar', null).ok, false);
  assert.equal(f.acceptSuggestion('flue loose at the collar', { text: 'hi' }).ok, false);
});

check('a note that was already fine is accepted and marked unchanged', () => {
  // So the screen can say so, rather than showing an identical suggestion and
  // asking somebody to compare two sentences that are the same.
  const verdict = accepted(
    'The flue is loose at the collar.',
    'The flue is loose at the collar.',
  );
  assert.equal(verdict.changed, false);
});

// ---------------------------------------------------------------------------
// What is worth sending at all.
// ---------------------------------------------------------------------------

check('THE INVENTION FLOOR: too little to tidy is refused before the call', () => {
  // "no trap" cleaned up is either "no trap" or something the inspector did not
  // say. There is no third outcome, and asking costs money to find that out.
  assert.equal(f.acceptNote('no trap').ok, false);
  assert.equal(f.acceptNote('   ').ok, false);
  assert.equal(f.acceptNote(undefined).ok, false);
  assert.equal(f.acceptNote(42).ok, false);
});

check('an ordinary note is sendable', () => {
  const decision = f.acceptNote('  no condensate trap on the ac unit  ');
  assert.equal(decision.ok, true);
  assert.equal(decision.note, 'no condensate trap on the ac unit');
});

check('and something the size of a report is not', () => {
  assert.equal(f.acceptNote('x'.repeat(f.MAX_CHARS + 1)).ok, false);
  assert.equal(f.acceptNote('word '.repeat(200)).ok, true);
});

// ---------------------------------------------------------------------------
// The instruction the model is given.
// ---------------------------------------------------------------------------

check('the prompt forbids the thing the gate is checking for', () => {
  // A weak assertion on its own. It is here so that the instruction and the
  // enforcement cannot drift apart unnoticed — if somebody loosens one, this
  // is the second place they have to look at.
  assert.match(f.SYSTEM_PROMPT, /do not add any fact/i);
  assert.match(f.SYSTEM_PROMPT, /absent/i);
  assert.match(f.SYSTEM_PROMPT, /serial/i);
});

console.log(failures === 0 ? '\nAll scribe checks passed.\n' : `\n${failures} FAILED\n`);
process.exit(failures === 0 ? 0 : 1);
