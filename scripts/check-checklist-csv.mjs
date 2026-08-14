/**
 * The checklist spreadsheet, out and back again.
 *
 * The round trip is the whole promise of this format: an admin exports their
 * library, edits fifty checkpoints in Excel, and uploads the result. If writing
 * and reading disagree about a single column name — or about what an empty
 * `unit` cell means, or which spellings of "yes" count — the failure lands
 * after the editing, on a file somebody has spent an afternoon in.
 *
 * The CSV reader gets its own attention because the app's own export is the
 * first thing that breaks a naive one: "Permits pulled, posted on site" is row
 * two, and splitting on commas turns it into two fields and the rest of the row
 * into rubbish.
 */
import { build } from 'vite';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const out = mkdtempSync(join(tmpdir(), 'qc-csv-'));

await build({
  logLevel: 'error',
  build: {
    lib: {
      entry: new URL('../src/lib/checklistCsv.ts', import.meta.url).pathname,
      formats: ['es'],
      fileName: 'checklistCsv',
    },
    outDir: out,
    emptyOutDir: true,
    minify: false,
  },
});

const m = await import(join(out, 'checklistCsv.js'));

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

/** The app writes CSV through `toCsv`; this mirrors it closely enough to parse. */
function toCsv(rows) {
  const field = (value) => {
    const text = String(value ?? '');
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return `﻿${rows.map((row) => row.map(field).join(',')).join('\r\n')}\r\n`;
}

const shared = {
  universalSection: {
    id: 'universal',
    title: 'Universal QC Standards',
    questions: [{ id: 'u-scope', text: 'Installed work matches the signed scope', critical: true }],
  },
};

const templates = [
  {
    id: 'tpl_a',
    name: 'Ductless Commissioning',
    category: 'mitsubishi-ductless',
    summary: 'Commissioning checks for a ductless head.',
    sections: [
      {
        id: 's1',
        title: 'Refrigerant',
        questions: [
          {
            id: 'q1',
            // The comma is the point: this is what breaks a split(',') reader.
            text: 'Line set insulated, sealed, and supported',
            kind: 'yesno',
            critical: true,
            help: 'Check the full run, not just at the head.',
          },
          {
            id: 'q2',
            text: 'Measured subcooling',
            kind: 'measurement',
            unit: '°F',
            photoOnPass: true,
          },
        ],
      },
      {
        id: 's2',
        title: 'Controls',
        questions: [{ id: 'q3', text: 'Homeowner shown the controls', kind: 'text' }],
      },
    ],
  },
  {
    id: 'tpl_archived',
    name: 'Retired Checklist',
    category: 'custom',
    summary: '',
    archived: true,
    sections: [{ id: 's9', title: 'Old', questions: [{ id: 'q9', text: 'Something', kind: 'yesno' }] }],
  },
];

// ---------------------------------------------------------------------------

check('the header is the documented column list', () => {
  const rows = m.checklistCsvRows(templates, shared);
  assert.deepEqual(rows[0], [...m.COLUMNS]);
});

check('the shared block is exported once, and never under a checklist', () => {
  const rows = m.checklistCsvRows(templates, shared);
  const sharedRows = rows.slice(1).filter((row) => row[1] === m.SHARED_ID);
  assert.equal(sharedRows.length, 1, 'the universal block should appear exactly once');
});

check('an archived checklist stays out unless asked for', () => {
  const without = m.checklistCsvRows(templates, shared);
  const withIt = m.checklistCsvRows(templates, shared, { includeArchived: true });
  assert.ok(!without.some((row) => row[1] === 'tpl_archived'));
  assert.ok(withIt.some((row) => row[1] === 'tpl_archived'));
});

check('THE ROUND TRIP: export, parse, and nothing has changed', () => {
  const csv = toCsv(m.checklistCsvRows(templates, shared));
  const result = m.parseChecklistCsv(csv);

  assert.equal(result.fatal, undefined, result.fatal);
  assert.deepEqual(result.problems, []);
  assert.equal(result.checklists.length, 1, 'only the one live checklist comes back');

  const [back] = result.checklists;
  const original = templates[0];
  assert.equal(back.id, original.id);
  assert.equal(back.name, original.name);
  assert.equal(back.category, original.category);
  assert.equal(back.description, original.summary);
  assert.equal(back.checkpoints, 3);

  // Sections keep their identity, their order, and their contents.
  assert.deepEqual(
    back.sections.map((section) => [section.id, section.title]),
    [
      ['s1', 'Refrigerant'],
      ['s2', 'Controls'],
    ],
  );
  assert.deepEqual(back.sections[0].questions[0], original.sections[0].questions[0]);
  assert.deepEqual(back.sections[0].questions[1], original.sections[0].questions[1]);
  assert.deepEqual(back.sections[1].questions[0], original.sections[1].questions[0]);
});

check('the shared block is skipped on the way back in', () => {
  const csv = toCsv(m.checklistCsvRows(templates, shared));
  const result = m.parseChecklistCsv(csv);
  assert.ok(!result.checklists.some((entry) => entry.id === m.SHARED_ID));
  assert.ok(result.skipped >= 1, 'and it is counted as skipped rather than lost silently');
});

check('a comma inside a checkpoint survives the trip', () => {
  const csv = toCsv(m.checklistCsvRows(templates, shared));
  const [back] = m.parseChecklistCsv(csv).checklists;
  assert.equal(back.sections[0].questions[0].text, 'Line set insulated, sealed, and supported');
});

check('quotes, newlines and CRLF inside a cell survive too', () => {
  const csv = toCsv([
    [...m.COLUMNS],
    ['A', '', '', '', 'S', '', '', 'He said "check it"', 'yesno', '', '', '', 'Line one\nline two'],
  ]);
  const [back] = m.parseChecklistCsv(csv).checklists;
  assert.equal(back.sections[0].questions[0].text, 'He said "check it"');
  assert.equal(back.sections[0].questions[0].help, 'Line one\nline two');
});

check('columns are matched by name, so order and extras do not matter', () => {
  const csv = toCsv([
    ['checkpoint', 'notes_we_do_not_read', 'section', 'checklist', 'type'],
    ['Filter seated', 'ignore me', 'Air handling', 'Reordered', 'yesno'],
  ]);
  const result = m.parseChecklistCsv(csv);
  assert.deepEqual(result.problems, []);
  assert.equal(result.checklists[0].name, 'Reordered');
  assert.equal(result.checklists[0].sections[0].questions[0].text, 'Filter seated');
});

check('a file missing a required column is refused as a whole', () => {
  const csv = toCsv([
    ['checklist', 'section'],
    ['A', 'S'],
  ]);
  const result = m.parseChecklistCsv(csv);
  assert.match(result.fatal ?? '', /checkpoint/);
  assert.equal(result.checklists.length, 0);
});

check('one bad row is reported by line and the rest of the file still reads', () => {
  const csv = toCsv([
    [...m.COLUMNS],
    ['A', '', '', '', 'S', '', '', 'Good one', 'yesno', '', '', '', ''],
    ['A', '', '', '', 'S', '', '', 'Bad type', 'maybe', '', '', '', ''],
    ['A', '', '', '', 'S', '', '', 'Another good one', 'text', '', '', '', ''],
  ]);
  const result = m.parseChecklistCsv(csv);
  assert.equal(result.problems.length, 1);
  assert.equal(result.problems[0].line, 3, 'the line number matches the spreadsheet row');
  assert.match(result.problems[0].message, /maybe/);
  assert.equal(result.checklists[0].checkpoints, 2, 'the good rows still came through');
});

check('blank rows and rows with no checkpoint are skipped, not reported', () => {
  const csv = toCsv([
    [...m.COLUMNS],
    ['', '', '', '', '', '', '', '', '', '', '', '', ''],
    ['A', '', '', '', 'S', '', '', '', 'yesno', '', '', '', 'guidance with no checkpoint'],
    ['A', '', '', '', 'S', '', '', 'Real one', 'yesno', '', '', '', ''],
  ]);
  const result = m.parseChecklistCsv(csv);
  assert.deepEqual(result.problems, []);
  assert.equal(result.skipped, 2);
  assert.equal(result.checklists[0].checkpoints, 1);
});

check('rows gather by name when the id column is left blank', () => {
  const csv = toCsv([
    [...m.COLUMNS],
    ['Same Checklist', '', '', '', 'One', '', '', 'First', 'yesno', '', '', '', ''],
    ['Same Checklist', '', '', '', 'Two', '', '', 'Second', 'yesno', '', '', '', ''],
    ['Other', '', '', '', 'One', '', '', 'Third', 'yesno', '', '', '', ''],
  ]);
  const result = m.parseChecklistCsv(csv);
  assert.equal(result.checklists.length, 2);
  assert.equal(result.checklists[0].sections.length, 2, 'two sections, one checklist');
  assert.equal(result.checklists[0].id, '', 'and no id, so the caller knows to make one');
});

check('a new checklist gets ids minted for its sections and checkpoints', () => {
  const csv = toCsv([
    [...m.COLUMNS],
    ['Fresh', '', '', '', 'S', '', '', 'A checkpoint', 'yesno', '', '', '', ''],
  ]);
  const [back] = m.parseChecklistCsv(csv).checklists;
  assert.ok(back.sections[0].id.length > 0);
  assert.ok(back.sections[0].questions[0].id.length > 0);
});

check('the flag columns take the spellings people actually type', () => {
  const rows = [[...m.COLUMNS]];
  for (const flag of ['yes', 'YES', 'true', 'TRUE', '1', 'x', 'X']) {
    rows.push(['A', '', '', '', 'S', '', '', `Critical via ${flag}`, 'yesno', '', flag, '', '']);
  }
  for (const flag of ['', 'no', 'false', '0']) {
    rows.push(['A', '', '', '', 'S', '', '', `Not critical via "${flag}"`, 'yesno', '', flag, '', '']);
  }
  const [back] = m.parseChecklistCsv(toCsv(rows)).checklists;
  const questions = back.sections[0].questions;
  assert.equal(questions.filter((q) => q.critical).length, 7);
  assert.equal(questions.filter((q) => !q.critical).length, 4);
});

check('a unit is kept only where it means something', () => {
  const csv = toCsv([
    [...m.COLUMNS],
    ['A', '', '', '', 'S', '', '', 'A measurement', 'measurement', 'CFM', '', '', ''],
    ['A', '', '', '', 'S', '', '', 'A yes/no', 'yesno', 'CFM', '', '', ''],
  ]);
  const [back] = m.parseChecklistCsv(csv).checklists;
  assert.equal(back.sections[0].questions[0].unit, 'CFM');
  assert.equal(back.sections[0].questions[1].unit, undefined, 'a yes/no has nothing to label');
});

check('the downloadable template parses as its own format', () => {
  const csv = toCsv(m.blankChecklistCsvRows());
  const result = m.parseChecklistCsv(csv);
  assert.equal(result.fatal, undefined, result.fatal);
  assert.deepEqual(result.problems, [], 'the example an admin is handed must not be broken');
  assert.equal(result.checklists.length, 1);
  assert.equal(result.checklists[0].sections.length, 2);
  assert.equal(result.checklists[0].id, '', 'the example makes a new checklist, never overwrites one');
});

check('an empty file says so rather than parsing to nothing', () => {
  assert.match(m.parseChecklistCsv('').fatal ?? '', /empty/i);
});

// A file saved by hand, or by a tool that does not write a trailing newline.
check('a file with no trailing newline keeps its last row', () => {
  const csv = ['checklist,section,checkpoint', 'A,S,Last row with no newline'].join('\n');
  const result = m.parseChecklistCsv(csv);
  assert.equal(result.checklists[0].sections[0].questions[0].text, 'Last row with no newline');
});

/**
 * The committed doc is written by `scripts/export-checklists.mjs`, which builds
 * its own header rather than importing this module — it runs against bundled
 * templates and cannot reach into `src/lib`. So the one thing holding the two
 * in the same format is this check.
 */
check("the repo's own checklist export is a file the app can read back", () => {
  const doc = readFileSync(new URL('../docs/checklists.csv', import.meta.url), 'utf8');
  const result = m.parseChecklistCsv(doc);
  assert.equal(result.fatal, undefined, result.fatal);
  assert.deepEqual(
    result.problems,
    [],
    'docs/checklists.csv no longer parses — run npm run checklists:export',
  );
  assert.ok(result.checklists.length > 0, 'nothing came back from the shipped export');
  assert.ok(
    result.checklists.every((entry) => entry.id && entry.name),
    'every shipped checklist should keep its id and name through the trip',
  );
});

console.log('');
if (failures > 0) {
  console.error(`${failures} checklist CSV check(s) failed.`);
  process.exit(1);
}
console.log('All checklist CSV checks passed.');
