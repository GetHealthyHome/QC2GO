/**
 * Where the pieces of a report land on a page.
 *
 * The customer-facing PDF is generated once and handed over; nobody proofreads
 * it against the app afterwards. So the assertions here are weighted towards
 * the failures that would never be noticed: a checkpoint that silently does not
 * appear, a serial number running off the edge of the page, and a run that
 * never terminates and simply hangs the phone that asked for the file.
 *
 * Note on the loop test: a pagination bug of that kind cannot be asserted
 * against from inside the same thread. If this script hangs rather than
 * failing, that IS the failure.
 */
import { build } from 'vite';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const out = mkdtempSync(join(tmpdir(), 'qc-pdf-'));

await build({
  logLevel: 'error',
  build: {
    lib: {
      entry: new URL('../src/lib/pdf/layout.ts', import.meta.url).pathname,
      formats: ['es'],
      fileName: 'layout',
    },
    outDir: out,
    emptyOutDir: true,
    minify: false,
  },
});

const { paginate, wrapText, encodable } = await import(join(out, 'layout.js'));

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

const PAGE = { height: 100 };
const block = (key, height, extra) => ({ key, height, ...extra });

/** Every placement across every page, in order. */
const flat = (pages) => pages.flatMap((page) => page.blocks);

// ---------------------------------------------------------------------------
// Nothing may go missing.
// ---------------------------------------------------------------------------

check('THE ONE THAT MATTERS: every block comes out again', () => {
  const blocks = Array.from({ length: 40 }, (_, i) => block(`b${i}`, 7 + (i % 5) * 6));
  const placed = flat(paginate(blocks, PAGE));
  assert.deepEqual(
    placed.map((entry) => entry.key),
    blocks.map((entry) => entry.key),
    'blocks were dropped, duplicated or reordered',
  );
});

check('and in the order it was given, across page breaks', () => {
  const blocks = Array.from({ length: 25 }, (_, i) => block(`b${i}`, 30));
  const pages = paginate(blocks, PAGE);
  assert.ok(pages.length > 1, 'this case is meaningless on a single page');
  assert.deepEqual(
    flat(pages).map((entry) => entry.key),
    blocks.map((entry) => entry.key),
  );
});

check('a splittable block keeps every one of its units', () => {
  const blocks = [
    block('lead', 80),
    block('body', 200, { split: { unitHeight: 10, units: 20, minUnits: 2 } }),
  ];
  const pieces = flat(paginate(blocks, PAGE)).filter((entry) => entry.key === 'body');
  const total = pieces.reduce((sum, piece) => sum + piece.part.units, 0);
  assert.equal(total, 20, 'lines of the paragraph were lost at a page break');
  assert.deepEqual(
    pieces.map((piece) => piece.part.unitStart),
    pieces.reduce(
      (starts, piece) => [...starts, starts.at(-1) + (pieces[starts.length - 1]?.part.units ?? 0)],
      [0],
    ).slice(0, pieces.length),
    'the pieces do not join back up into one continuous run',
  );
});

check('an empty document still produces one page rather than none', () => {
  // A report with nothing in it is a bug upstream, but a zero-page PDF is a
  // file that will not open at all, which is a worse way to find out.
  const pages = paginate([], PAGE);
  assert.equal(pages.length, 1);
  assert.deepEqual(pages[0].blocks, []);
});

// ---------------------------------------------------------------------------
// Termination.
// ---------------------------------------------------------------------------

check('THE HANG: a block taller than the page is placed, not looped over', () => {
  const pages = paginate([block('a', 20), block('huge', 400), block('b', 20)], PAGE);
  const placed = flat(pages);
  assert.deepEqual(placed.map((entry) => entry.key), ['a', 'huge', 'b']);
  const huge = pages.find((page) => page.blocks.some((entry) => entry.key === 'huge'));
  assert.equal(huge.blocks.length, 1, 'the oversized block should get a page to itself');
  assert.equal(huge.blocks[0].y, 0);
});

check('a splittable block whose single unit exceeds the page also terminates', () => {
  const pages = paginate(
    [block('a', 20), block('tall', 600, { split: { unitHeight: 200, units: 3, minUnits: 1 } })],
    PAGE,
  );
  const pieces = flat(pages).filter((entry) => entry.key === 'tall');
  assert.equal(
    pieces.reduce((sum, piece) => sum + piece.part.units, 0),
    3,
  );
});

check('a minUnits larger than a page does not deadlock', () => {
  // minUnits says "never break leaving fewer than this", and a value that can
  // never be satisfied is a configuration mistake, not a reason to spin.
  const pages = paginate(
    [block('a', 90), block('body', 300, { split: { unitHeight: 10, units: 30, minUnits: 25 } })],
    PAGE,
  );
  assert.equal(
    flat(pages)
      .filter((entry) => entry.key === 'body')
      .reduce((sum, piece) => sum + piece.part.units, 0),
    30,
  );
});

// ---------------------------------------------------------------------------
// Where the breaks fall.
// ---------------------------------------------------------------------------

check('nothing overflows the page except the block that cannot fit anywhere', () => {
  const blocks = Array.from({ length: 30 }, (_, i) => block(`b${i}`, 13 + (i % 4)));
  for (const page of paginate(blocks, { height: 100, gap: 3 })) {
    for (const placed of page.blocks) {
      assert.ok(
        placed.y + placed.height <= 100,
        `${placed.key} runs past the bottom of page ${page.number}`,
      );
    }
  }
});

check('THE STRANDED HEADING: a heading never ends a page alone', () => {
  // A section title at the foot of one page with its contents on the next
  // reads as a section with nothing in it.
  const blocks = [
    block('filler', 70),
    block('heading', 20, { keepWithNext: true }),
    block('row', 40),
  ];
  const pages = paginate(blocks, PAGE);
  const headingPage = pages.find((page) => page.blocks.some((e) => e.key === 'heading'));
  assert.ok(
    headingPage.blocks.some((entry) => entry.key === 'row'),
    'the heading was left at the bottom of a page by itself',
  );
});

check('a heading only has to bring the minimum of a splittable follower', () => {
  // Demanding the whole paragraph fit would push headings onto new pages for
  // no reason, leaving half-empty pages throughout a long report.
  const blocks = [
    block('filler', 40),
    block('heading', 10, { keepWithNext: true }),
    block('body', 300, { split: { unitHeight: 10, units: 30, minUnits: 2 } }),
  ];
  const pages = paginate(blocks, PAGE);
  assert.equal(pages[0].blocks[1].key, 'heading', 'the heading was pushed to a new page');
  assert.equal(pages[0].blocks[2].key, 'body');
});

check('THE WIDOW: one line is never left behind at the top of a page', () => {
  // Room for exactly nine of the ten lines. Taking all nine puts a single line
  // alone at the top of the next page, so the break is refused and the whole
  // paragraph moves down together.
  const blocks = [
    block('filler', 10),
    block('body', 100, { split: { unitHeight: 10, units: 10, minUnits: 2 } }),
  ];
  const pieces = flat(paginate(blocks, PAGE)).filter((entry) => entry.key === 'body');
  for (const piece of pieces) {
    assert.ok(piece.part.units >= 2, `a piece of only ${piece.part.units} line(s) was left alone`);
  }
  assert.equal(pieces.length, 1, 'the paragraph was broken when it did not have to be');
});

check('nor at the bottom of one', () => {
  // The mirror case: room for exactly one line before the break.
  const blocks = [
    block('filler', 89),
    block('body', 100, { split: { unitHeight: 10, units: 10, minUnits: 2 } }),
  ];
  const pieces = flat(paginate(blocks, PAGE)).filter((entry) => entry.key === 'body');
  for (const piece of pieces) {
    assert.ok(piece.part.units >= 2, `a piece of only ${piece.part.units} line(s) was left alone`);
  }
});

check('but a break that strands nobody is still taken', () => {
  // Widow control that refuses every break turns into "never split at all",
  // which leaves half-empty pages through a long report.
  const blocks = [
    block('filler', 50),
    block('body', 100, { split: { unitHeight: 10, units: 10, minUnits: 2 } }),
  ];
  const pieces = flat(paginate(blocks, PAGE)).filter((entry) => entry.key === 'body');
  assert.equal(pieces.length, 2, 'the paragraph did not use the room available to it');
  assert.deepEqual(
    pieces.map((piece) => piece.part.units),
    [5, 5],
  );
});

check('page numbers run from one, without gaps', () => {
  const pages = paginate(
    Array.from({ length: 30 }, (_, i) => block(`b${i}`, 25)),
    PAGE,
  );
  assert.deepEqual(
    pages.map((page) => page.number),
    pages.map((_, index) => index + 1),
  );
});

check('the letterhead only costs room on the first page', () => {
  const blocks = Array.from({ length: 12 }, (_, i) => block(`b${i}`, 20));
  const pages = paginate(blocks, { height: 100, firstPageOffset: 60 });
  assert.equal(pages[0].blocks[0].y, 60, 'page one did not start below the letterhead');
  assert.equal(pages[1].blocks[0].y, 0, 'page two left a gap where the letterhead was');
  assert.equal(pages[0].blocks.length, 2, 'page one ignored the space the letterhead took');
});

// ---------------------------------------------------------------------------
// Text that has to fit a column.
// ---------------------------------------------------------------------------

/** One point per character — enough to exercise the wrapping, not the font. */
const perChar = (value) => value.length;

check('ordinary text wraps at word boundaries and loses nothing', () => {
  const text = 'condensate line terminates outside and is sloped away from the structure';
  const lines = wrapText(text, 20, perChar);
  for (const line of lines) assert.ok(line.length <= 20, `"${line}" is too wide`);
  assert.equal(lines.join(' '), text, 'words were dropped or duplicated by the wrap');
});

check("THE SERIAL: a token wider than the column is cut, not run off the page", () => {
  // The one case a plain word-wrapper has no answer for. A serial arrives as a
  // single unbroken token, and the half past the margin is the half somebody
  // needs for a warranty registration.
  const serial = '1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ098765';
  const lines = wrapText(serial, 12, perChar);
  for (const line of lines) assert.ok(line.length <= 12, `"${line}" is too wide`);
  assert.equal(lines.join(''), serial, 'characters were lost splitting the serial');
  assert.ok(lines.length > 1, 'the serial was not split at all');
});

check('a hard-split token still packs the lines it is given', () => {
  const lines = wrapText('AAAAAAAAAA', 4, perChar);
  assert.deepEqual(lines, ['AAAA', 'AAAA', 'AA']);
});

check("an inspector's line breaks are kept", () => {
  // Notes are written in paragraphs. Reflowing them into one block loses what
  // the person writing meant by the break.
  const lines = wrapText('first note\nsecond note', 40, perChar);
  assert.deepEqual(lines, ['first note', 'second note']);
});

check('a blank line stays a blank line', () => {
  assert.deepEqual(wrapText('a\n\nb', 40, perChar), ['a', '', 'b']);
});

check('empty text produces one empty line rather than nothing', () => {
  assert.deepEqual(wrapText('', 40, perChar), ['']);
});

check('runs of spaces do not become empty lines', () => {
  assert.deepEqual(wrapText('a     b', 40, perChar), ['a b']);
});

check('a column too narrow for one character does not loop', () => {
  const lines = wrapText('abc', 0.5, perChar);
  assert.equal(lines.join(''), 'abc');
});

// ---------------------------------------------------------------------------
// Characters the built-in fonts cannot draw.
// ---------------------------------------------------------------------------

check('THE BROKEN BUTTON: an emoji in a note does not stop the report', () => {
  // pdf-lib throws on a glyph it cannot encode rather than drawing a box, so
  // one pasted character would turn "Download PDF" into a button that silently
  // does nothing.
  const clean = encodable('roof vent blocked 👍 fixed');
  assert.ok(!/[\u{1f000}-\u{1ffff}]/u.test(clean), 'the emoji survived');
  assert.ok(clean.startsWith('roof vent blocked '));
  assert.ok(clean.endsWith(' fixed'), 'text after the emoji was lost');
});

check('a control byte from a scanner is replaced, not carried through', () => {
  // Some scanners emit a leading group separator. It is invisible on screen
  // and would take the whole serial down with it.
  assert.equal(encodable('ABC\u001d123'), 'ABC?123');
});

check('accents, dashes and quotes are left alone', () => {
  // These are all drawable, and mangling an installer's surname to make the
  // PDF safe would be its own defect.
  const text = 'José — "condensate" line ½ full · 40°C';
  assert.equal(encodable(text), text);
});

check('line breaks survive the substitution', () => {
  assert.equal(encodable('one\ntwo'), 'one\ntwo');
});

console.log(failures === 0 ? '\nAll PDF layout checks passed.\n' : `\n${failures} FAILED\n`);
process.exit(failures === 0 ? 0 : 1);
