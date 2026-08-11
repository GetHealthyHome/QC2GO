/**
 * Round-trip the sync mappers: local record -> database row -> local record.
 *
 * A misspelled column ("work_scope" vs "workscope") is not a type error and not
 * a runtime error either — PostgREST just ignores the key and the field arrives
 * back empty. This is the only thing that catches that.
 */
import { build } from 'vite';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const out = mkdtempSync(join(tmpdir(), 'qc-map-'));

await build({
  logLevel: 'error',
  build: {
    lib: { entry: new URL('../src/lib/syncMap.ts', import.meta.url).pathname, formats: ['es'], fileName: 'syncMap' },
    outDir: out,
    emptyOutDir: true,
    minify: false,
  },
});

const m = await import(join(out, 'syncMap.js'));

const USER = '22222222-2222-2222-2222-222222222222';
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

// ---------------------------------------------------------------------------

const customer = {
  id: 'cust-1',
  customerName: 'Ada Whitfield',
  address: '14 Marsh Lane',
  phone: '555-0100',
  salesperson: 'Dana Reyes',
  teamLeader: 'Chris Lin',
  jobNumber: 'WO-4471',
  workScope: 'Attic air seal + 2 ductless heads. Dog on site, side gate.',
  templateIds: ['home-performance', 'quilt'],
  location: { lat: 42.3601, lng: -71.0589, accuracy: 8, capturedAt: '2026-08-11T14:02:00.000Z' },
  archived: false,
  createdBy: USER,
  createdAt: '2026-08-01T09:00:00.000Z',
  updatedAt: '2026-08-11T14:05:00.000Z',
};

check('customer survives the round trip intact', () => {
  const back = m.rowToCustomer(m.customerToRow(customer, USER));
  assert.deepEqual(back, customer);
});

check('customer keeps its original author when someone else edits it', () => {
  const row = m.customerToRow(customer, 'aaaaaaaa-0000-0000-0000-000000000000');
  assert.equal(row.created_by, USER, 'the editor must not take ownership');
});

check('a locally created customer is attributed to whoever is signed in', () => {
  const { createdBy, ...local } = customer;
  const row = m.customerToRow(local, USER);
  assert.equal(row.created_by, USER);
});

// ---------------------------------------------------------------------------

const inspection = {
  id: 'insp-1',
  customerId: 'cust-1',
  templateId: 'home-performance',
  snapshot: {
    templateId: 'home-performance',
    templateName: 'Home Performance',
    templateVersion: 3,
    infoFields: [{ id: 'inspector', label: 'Inspected by', type: 'text' }],
    sections: [{ id: 's1', title: 'Envelope', questions: [{ id: 'q1', text: 'Sealed?' }] }],
    capturedAt: '2026-08-11T14:00:00.000Z',
  },
  visitType: 'final-walkthrough',
  visitDate: '2026-08-11',
  status: 'completed',
  info: { inspector: 'Sam Okafor', customerPresent: 'Yes' },
  responses: {
    q1: { answer: 'no', note: 'Rim joist left open at the south wall.', photoIds: ['img-1'] },
    q2: { answer: 'yes', photoIds: [] },
  },
  summaryNotes: 'Punch list issued to crew.',
  inspectorSignature: { name: 'Sam Okafor', dataUrl: 'data:image/png;base64,AAA', signedAt: '2026-08-11T16:00:00.000Z' },
  customerSignature: { name: 'Ada Whitfield', dataUrl: 'data:image/png;base64,BBB', signedAt: '2026-08-11T16:01:00.000Z' },
  createdBy: USER,
  createdAt: '2026-08-11T14:00:00.000Z',
  updatedAt: '2026-08-11T16:01:00.000Z',
  completedAt: '2026-08-11T16:01:00.000Z',
};

const known = new Set(['home-performance']);

check('inspection survives the round trip intact', () => {
  const back = m.rowToInspection(m.inspectionToRow(inspection, USER, known));
  assert.deepEqual(back, inspection);
});

check('the frozen snapshot is carried across untouched', () => {
  const back = m.rowToInspection(m.inspectionToRow(inspection, USER, known));
  assert.equal(back.snapshot.templateVersion, 3);
  assert.deepEqual(back.snapshot.sections, inspection.snapshot.sections);
});

check('a No answer keeps its explanation and its photo', () => {
  const back = m.rowToInspection(m.inspectionToRow(inspection, USER, known));
  assert.equal(back.responses.q1.note, 'Rim joist left open at the south wall.');
  assert.deepEqual(back.responses.q1.photoIds, ['img-1']);
});

check('an unknown checklist drops the FK but not the identity', () => {
  const row = m.inspectionToRow(inspection, USER, new Set());
  assert.equal(row.template_id, null, 'must not point at a checklist the server lacks');
  const back = m.rowToInspection(row);
  assert.equal(back.templateId, 'home-performance', 'recovered from the snapshot');
});

// ---------------------------------------------------------------------------

const photo = {
  id: 'img-1',
  inspectionId: 'insp-1',
  questionId: 'q1',
  caption: 'Rim joist, south wall',
  createdAt: '2026-08-11T14:30:00.000Z',
};

check('photo round trips and keeps its bucket key', () => {
  const path = m.storagePathFor(photo);
  assert.equal(path, 'insp-1/img-1.jpg', 'must match the storage RLS policy shape');
  const back = m.rowToPhoto(m.photoToRow(photo, USER, path));
  assert.deepEqual(back, { ...photo, storagePath: path });
});

// ---------------------------------------------------------------------------

const template = {
  id: 'home-performance',
  name: 'Home Performance',
  category: 'home-performance',
  summary: 'Envelope, insulation, and combustion safety.',
  sections: [{ id: 's1', title: 'Envelope', questions: [{ id: 'q1', text: 'Sealed?', critical: true }] }],
  builtIn: true,
  archived: false,
  version: 3,
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
};

check('template survives the round trip intact', () => {
  const back = m.rowToTemplate(m.templateToRow(template, USER));
  assert.deepEqual(back, template);
});

const shared = {
  infoFields: [{ id: 'inspector', label: 'Inspected by', type: 'text', required: true }],
  universalSection: { id: 'universal', title: 'Universal QC Standards', questions: [{ id: 'u1', text: 'Scope matches' }] },
  salespeople: ['Dana Reyes', 'Sam Okafor'],
  teamLeaders: ['Chris Lin'],
  updatedAt: '2026-08-01T00:00:00.000Z',
};

check('shared config round trips, pick lists included', () => {
  const back = m.rowToShared(m.sharedToRow(shared));
  assert.deepEqual(back, shared);
});

// ---------------------------------------------------------------------------
// What Postgres actually hands back is not what we sent.
// ---------------------------------------------------------------------------

check('postgres timestamp format normalises to ISO', () => {
  const back = m.rowToCustomer({
    ...m.customerToRow(customer, USER),
    updated_at: '2026-08-11 14:05:00+00',
  });
  assert.equal(back.updatedAt, '2026-08-11T14:05:00.000Z', 'watermark comparison is a string compare');
});

check('null columns become absent fields, not the string "null"', () => {
  const back = m.rowToCustomer({
    id: 'cust-2', customer_name: 'B', address: 'C', salesperson: '', team_leader: '',
    phone: null, job_number: null, work_scope: null, location: null, template_ids: null,
    archived: false, created_by: null, created_at: null, updated_at: null,
  });
  assert.equal(back.phone, undefined);
  assert.equal(back.workScope, undefined);
  assert.deepEqual(back.templateIds, []);
});

console.log(failures === 0 ? '\nAll mapper checks passed.' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
