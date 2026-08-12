/**
 * The spreadsheet export.
 *
 * CSV looks trivial and is not. A quote in a customer's name, a comma in an
 * address, a measurement starting with a minus sign — each has a way of turning
 * a file the office opens once a month into either a parse error or, worse,
 * something that looks fine and says the wrong thing.
 */
import { build } from 'vite';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const out = mkdtempSync(join(tmpdir(), 'qc-export-'));

await build({
  logLevel: 'error',
  build: {
    lib: {
      entry: new URL('../src/lib/exportCsv.ts', import.meta.url).pathname,
      formats: ['es'],
      fileName: 'exportCsv',
    },
    outDir: out,
    emptyOutDir: true,
    minify: false,
  },
});

const e = await import(join(out, 'exportCsv.js'));

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
// Field encoding
// ---------------------------------------------------------------------------

check('a comma in an address does not split the row', () => {
  assert.equal(e.csvField('118 Marsh Rd, Concord, MA'), '"118 Marsh Rd, Concord, MA"');
});

check('a quote in a name is doubled rather than ending the field', () => {
  assert.equal(e.csvField('Dana "Dan" Whitfield'), '"Dana ""Dan"" Whitfield"');
});

check('a newline inside an explanation is kept, quoted', () => {
  const field = e.csvField('Permit not posted.\nOffice to schedule.');
  assert.ok(field.startsWith('"') && field.endsWith('"'), field);
  assert.ok(field.includes('\n'), 'the newline was lost');
});

check('THE DANGEROUS ONE: a value cannot become a formula', () => {
  // Excel executes a field beginning with = + - or @. A measurement of "-2"
  // is ordinary in this app, and "=cmd|..." is the classic injection.
  for (const value of ['=1+1', '+1', '-2', '@SUM(A1)', '=cmd|\' /c calc\'!A1']) {
    const field = e.csvField(value);
    const inner = field.startsWith('"') ? field.slice(1, -1) : field;
    assert.ok(inner.startsWith('\t'), `${JSON.stringify(value)} encoded as ${field}`);
  }
});

check('an ordinary value is not mangled', () => {
  assert.equal(e.csvField('Pass'), 'Pass');
  assert.equal(e.csvField(94), '94');
  assert.equal(e.csvField(0), '0', 'zero must not become an empty cell');
  assert.equal(e.csvField(null), '');
  assert.equal(e.csvField(undefined), '');
});

check('the file opens as UTF-8 in Excel', () => {
  // Without the byte-order mark Excel reads it as Latin-1 and every ° and é
  // becomes mojibake — the kind of thing nobody reports and everybody works
  // around by hand.
  const csv = e.toCsv([['Outdoor temp (°F)'], ['-2']]);
  assert.ok(csv.startsWith('﻿'), 'no byte-order mark');
  assert.ok(csv.includes('°F'), 'the degree sign was lost');
});

check('rows end the way a spreadsheet expects', () => {
  const csv = e.toCsv([['a', 'b'], ['c', 'd']]);
  assert.equal(csv, '﻿a,b\r\nc,d\r\n');
});

// ---------------------------------------------------------------------------
// Row building
// ---------------------------------------------------------------------------

const shared = {
  infoFields: [],
  universalSection: { id: 'u', title: 'Universal', questions: [] },
  salespeople: [],
  teamLeaders: [],
  updatedAt: '2026-08-01T00:00:00.000Z',
};

const customers = [
  {
    id: 'cust-1',
    customerName: 'Dana Whitfield',
    address: '118 Marsh Rd, Concord, MA',
    salesperson: 'R. Alvarez',
    teamLeader: 'M. Okafor',
    templateIds: [],
    punchResolutions: { 'insp-1:q2': { at: '2026-08-20T10:00:00.000Z' } },
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
  },
];

const snapshot = {
  templateId: 'tpl',
  templateName: 'Mitsubishi Ductless',
  templateVersion: 2,
  infoFields: [],
  sections: [
    {
      id: 's1',
      title: 'Outdoor unit',
      questions: [
        { id: 'q1', text: 'Pad level' },
        { id: 'q2', text: 'Permit posted', critical: true },
        { id: 'q3', text: 'Line set length', kind: 'measurement', unit: 'ft' },
        { id: 'q4', text: 'Never answered' },
      ],
    },
  ],
  capturedAt: '2026-08-12T09:00:00.000Z',
};

const inspections = [
  {
    id: 'insp-1',
    customerId: 'cust-1',
    templateId: 'tpl',
    snapshot,
    visitType: 'final-walkthrough',
    visitDate: '2026-08-12',
    status: 'completed',
    info: { inspector: 'A. Holcombe' },
    responses: {
      q1: { answer: 'yes', photoIds: [] },
      q2: { answer: 'no', note: 'Not posted', photoIds: ['img-1'] },
      q3: { answer: null, value: '-2', photoIds: [] },
    },
    overallScore: 50,
    passFailStatus: 'FAIL',
    totalDeficiencies: 1,
    completedAt: '2026-08-12T16:00:00.000Z',
    createdAt: '2026-08-12T09:00:00.000Z',
    updatedAt: '2026-08-12T16:00:00.000Z',
  },
  // Still being walked — must not appear in either export.
  {
    id: 'insp-2',
    customerId: 'cust-1',
    templateId: 'tpl',
    snapshot,
    visitType: 'site-visit',
    visitDate: '2026-08-13',
    status: 'in-progress',
    info: {},
    responses: { q1: { answer: 'no', photoIds: [] } },
    createdAt: '2026-08-13T09:00:00.000Z',
    updatedAt: '2026-08-13T09:00:00.000Z',
  },
];

check('only completed inspections are exported', () => {
  const rows = e.inspectionRows(inspections, customers, [], shared);
  assert.equal(rows.length, 2, 'header plus one inspection');
  assert.equal(rows[1][0], 'insp-1');
});

check('the stored score is reported, not a second opinion', () => {
  // A spreadsheet disagreeing with the webhook and the dashboard would be worse
  // than a spreadsheet with a gap.
  const [, row] = e.inspectionRows(inspections, customers, [], shared);
  const headers = e.inspectionRows([], [], [], shared)[0];
  assert.equal(row[headers.indexOf('Score %')], 50);
  assert.equal(row[headers.indexOf('Result')], 'FAIL');
});

check('a corrected deficiency is no longer counted as open', () => {
  const headers = e.inspectionRows([], [], [], shared)[0];
  const [, row] = e.inspectionRows(inspections, customers, [], shared);
  assert.equal(row[headers.indexOf('Deficiencies')], 1);
  assert.equal(row[headers.indexOf('Open deficiencies')], 0, 'q2 was corrected on the customer');
});

check('every answered checkpoint gets a row, unanswered ones do not', () => {
  const rows = e.checkpointRows(inspections, customers, [], shared);
  const ids = rows.slice(1).map((row) => row[5]);
  assert.deepEqual(ids, ['Pad level', 'Permit posted', 'Line set length']);
  assert.ok(!ids.includes('Never answered'));
});

check('a measurement of -2 survives the round trip to a cell', () => {
  const rows = e.checkpointRows(inspections, customers, [], shared);
  const measurement = rows.find((row) => row[5] === 'Line set length');
  assert.equal(measurement[8], '-2');
  // And is neutralised on the way into the file rather than left executable.
  assert.ok(e.csvField(measurement[8]).includes('\t'));
});

check('the checkpoint export says whether a failure was corrected', () => {
  const rows = e.checkpointRows(inspections, customers, [], shared);
  const failed = rows.find((row) => row[5] === 'Permit posted');
  assert.equal(failed[6], 'Yes', 'critical flag');
  assert.equal(failed[7], 'No', 'answer');
  assert.equal(failed[11], 'Yes', 'corrected');

  const passed = rows.find((row) => row[5] === 'Pad level');
  assert.equal(passed[11], '', 'a passing checkpoint has nothing to correct');
});

check('wording comes from the frozen snapshot, not the live checklist', () => {
  // A checkpoint reworded last month must still appear with the wording that
  // was actually asked at the time.
  const reworded = [
    { id: 'tpl', name: 'Mitsubishi Ductless', category: 'x', summary: '', sections: [
      { id: 's1', title: 'Outdoor unit', questions: [{ id: 'q1', text: 'REWORDED' }] },
    ] },
  ];
  const rows = e.checkpointRows(inspections, customers, reworded, shared);
  assert.ok(!rows.some((row) => row[5] === 'REWORDED'), 'the live wording leaked in');
  assert.ok(rows.some((row) => row[5] === 'Pad level'));
});

check('the filename says what and when', () => {
  assert.match(e.exportFilename('inspections'), /^qc2go-inspections-\d{4}-\d{2}-\d{2}\.csv$/);
});

console.log(failures === 0 ? '\nAll export checks passed.\n' : `\n${failures} FAILED\n`);
process.exit(failures === 0 ? 0 : 1);
