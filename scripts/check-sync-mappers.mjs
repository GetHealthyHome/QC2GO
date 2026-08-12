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
const ORG = 'aaaaaaaa-1111-1111-1111-111111111111';
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
  // Nothing closed out yet — a customer with an empty punch list must round-trip
  // to exactly that rather than to an empty object.
  punchResolutions: undefined,
  location: { lat: 42.3601, lng: -71.0589, accuracy: 8, capturedAt: '2026-08-11T14:02:00.000Z' },
  archived: false,
  createdBy: USER,
  createdAt: '2026-08-01T09:00:00.000Z',
  updatedAt: '2026-08-11T14:05:00.000Z',
};

check('customer survives the round trip intact', () => {
  const back = m.rowToCustomer(m.customerToRow(customer, USER, ORG));
  assert.deepEqual(back, customer);
});

check('customer keeps its original author when someone else edits it', () => {
  const row = m.customerToRow(customer, 'aaaaaaaa-0000-0000-0000-000000000000', ORG);
  assert.equal(row.created_by, USER, 'the editor must not take ownership');
});

check('a locally created customer is attributed to whoever is signed in', () => {
  const { createdBy, ...local } = customer;
  const row = m.customerToRow(local, USER, ORG);
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
  overallScore: 94,
  passFailStatus: 'NEEDS_REVIEW',
  totalDeficiencies: 1,
  // Stated rather than left out: this fixture is an inspection that was never
  // reopened, and a round trip has to produce exactly that rather than an
  // empty array. `deepStrictEqual` tells the two apart.
  reopenings: undefined,
  inspectorSignature: { name: 'Sam Okafor', dataUrl: 'data:image/png;base64,AAA', signedAt: '2026-08-11T16:00:00.000Z' },
  customerSignature: { name: 'Ada Whitfield', dataUrl: 'data:image/png;base64,BBB', signedAt: '2026-08-11T16:01:00.000Z' },
  createdBy: USER,
  createdAt: '2026-08-11T14:00:00.000Z',
  updatedAt: '2026-08-11T16:01:00.000Z',
  completedAt: '2026-08-11T16:01:00.000Z',
};

check('inspection survives the round trip intact', () => {
  const back = m.rowToInspection(m.inspectionToRow(inspection, USER, ORG));
  assert.deepEqual(back, inspection);
});

check('the frozen snapshot is carried across untouched', () => {
  const back = m.rowToInspection(m.inspectionToRow(inspection, USER, ORG));
  assert.equal(back.snapshot.templateVersion, 3);
  assert.deepEqual(back.snapshot.sections, inspection.snapshot.sections);
});

check('a No answer keeps its explanation and its photo', () => {
  const back = m.rowToInspection(m.inspectionToRow(inspection, USER, ORG));
  assert.equal(back.responses.q1.note, 'Rim joist left open at the south wall.');
  assert.deepEqual(back.responses.q1.photoIds, ['img-1']);
});

check('the stored result round trips', () => {
  const back = m.rowToInspection(m.inspectionToRow(inspection, USER, ORG));
  assert.equal(back.overallScore, 94);
  assert.equal(back.passFailStatus, 'NEEDS_REVIEW');
  assert.equal(back.totalDeficiencies, 1);
});

check('an inspection with no result yet stays that way', () => {
  // Null and zero are different answers here: zero is a score, null is "this
  // is still being walked". A row that confused them would report every
  // in-progress inspection as a total failure.
  const { overallScore, passFailStatus, totalDeficiencies, ...open } = inspection;
  const row = m.inspectionToRow({ ...open, status: 'in-progress' }, USER, ORG);
  assert.equal(row.overall_score, null);
  assert.equal(row.pass_fail_status, null);
  assert.equal(row.total_deficiencies, null);

  const back = m.rowToInspection(row);
  assert.equal(back.overallScore, undefined);
  assert.equal(back.passFailStatus, undefined);
  assert.equal(back.totalDeficiencies, undefined);
});

check('reopenings round trip, and stay absent when there are none', () => {
  const back = m.rowToInspection(m.inspectionToRow(inspection, USER, ORG));
  assert.equal(back.reopenings, undefined, 'never reopened must round-trip to never reopened');

  const reopened = {
    ...inspection,
    reopenings: [
      { reason: 'Wrong permit number captured', at: '2026-08-12T09:00:00.000Z', by: 'boss@co.test' },
    ],
  };
  const there = m.rowToInspection(m.inspectionToRow(reopened, USER, ORG));
  assert.deepEqual(there.reopenings, reopened.reopenings);
});

check('the checklist id travels as written', () => {
  // 0004 dropped the foreign key this column used to carry, so there is no
  // longer any reason to null it out when the server has not seen the
  // checklist yet.
  const row = m.inspectionToRow(inspection, USER, ORG);
  assert.equal(row.template_id, 'home-performance');
});

check('an inspection with no checklist id still recovers it from the snapshot', () => {
  const row = m.inspectionToRow({ ...inspection, templateId: '' }, USER, ORG);
  assert.equal(row.template_id, null, 'an empty string is not an id');
  assert.equal(m.rowToInspection(row).templateId, 'home-performance');
});

// ---------------------------------------------------------------------------

const photo = {
  id: 'img-1',
  inspectionId: 'insp-1',
  questionId: 'q1',
  caption: 'Rim joist, south wall',
  takenAt: '2026-08-11T14:28:11.000Z',
  gps: { lat: 42.4601, lng: -71.3489 },
  gpsSource: 'exif',
  watermarked: true,
  // Stated rather than left out: an unmarked photo has to round-trip to
  // unmarked rather than to an empty array. `deepStrictEqual` tells them apart.
  annotations: undefined,
  createdAt: '2026-08-11T14:30:00.000Z',
};

check('photo round trips and keeps its bucket key', () => {
  const path = m.storagePathFor(photo, ORG);
  const back = m.rowToPhoto(m.photoToRow(photo, USER, ORG, path));
  assert.deepEqual(back, { ...photo, storagePath: path });
});

check('when and where a photo was taken survives the round trip', () => {
  const back = m.rowToPhoto(m.photoToRow(photo, USER, ORG, 'p'));
  assert.equal(back.takenAt, '2026-08-11T14:28:11.000Z');
  assert.deepEqual(back.gps, { lat: 42.4601, lng: -71.3489 });
  assert.equal(back.gpsSource, 'exif');
  assert.equal(back.watermarked, true);
});

check('a photo the camera told us nothing about stays that way', () => {
  // Most phones strip location from the camera. Absent has to round-trip to
  // absent rather than to a default that reads as a real answer.
  const { takenAt, gps, gpsSource, watermarked, ...bare } = photo;
  const row = m.photoToRow({ ...bare, watermarked: false }, USER, ORG, 'p');
  assert.equal(row.taken_at, null);
  assert.equal(row.gps, null);
  assert.equal(row.gps_source, null);

  const back = m.rowToPhoto(row);
  assert.equal(back.takenAt, undefined);
  assert.equal(back.gps, undefined);
  assert.equal(back.gpsSource, undefined);
  assert.equal(back.watermarked, undefined, 'not watermarked must not read as watermarked');
});

check('marks on a photo round trip, and absent stays absent', () => {
  const marked = {
    ...photo,
    annotations: [
      { id: 'a1', kind: 'arrow', color: 'red', points: [{ x: 0.2, y: 0.3 }, { x: 0.7, y: 0.6 }] },
    ],
  };
  const back = m.rowToPhoto(m.photoToRow(marked, USER, ORG, 'p'));
  assert.deepEqual(back.annotations, marked.annotations);

  const bare = m.rowToPhoto(m.photoToRow(photo, USER, ORG, 'p'));
  assert.equal(bare.annotations, undefined);
});

check('a bucket key starts with the organization', () => {
  // The storage policy reads the first path segment and compares it to the
  // caller's company. Any other shape makes the object unreadable at best, and
  // readable by the wrong company at worst.
  assert.equal(m.storagePathFor(photo, ORG), `${ORG}/insp-1/img-1.jpg`);
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
  const back = m.rowToTemplate(m.templateToRow(template, USER, ORG));
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
  const back = m.rowToShared(m.sharedToRow(shared, ORG));
  assert.deepEqual(back, shared);
});

check('punch resolutions round trip', () => {
  const withResolutions = {
    ...customer,
    punchResolutions: {
      'insp-1:q1': { at: '2026-08-20T15:00:00.000Z', by: 'sam@co.test', note: 'Rim joist sealed' },
    },
  };
  const back = m.rowToCustomer(m.customerToRow(withResolutions, USER, ORG));
  assert.deepEqual(back.punchResolutions, withResolutions.punchResolutions);
});

check('a resolution is never recorded against the inspection itself', () => {
  // A signed inspection is a record. If closing a punch item ever started
  // writing into one, this is where it would show up first.
  const row = m.inspectionToRow(inspection, USER, ORG);
  assert.equal('punch_resolutions' in row, false);
  const responses = JSON.stringify(row.responses);
  assert.equal(/resolved/.test(responses), false, 'a response carries no resolution flag');
});

check('every uploaded row carries the organization', () => {
  // The column has a server-side default, but a row that states its company is
  // a row the with-check policy can refuse. Silence would mean trusting it.
  assert.equal(m.customerToRow(customer, USER, ORG).org_id, ORG, 'customer');
  assert.equal(m.inspectionToRow(inspection, USER, ORG).org_id, ORG, 'inspection');
  assert.equal(m.photoToRow(photo, USER, ORG, 'p').org_id, ORG, 'photo');
  assert.equal(m.templateToRow(template, USER, ORG).org_id, ORG, 'template');
  assert.equal(m.sharedToRow(shared, ORG).org_id, ORG, 'shared config');
});

// ---------------------------------------------------------------------------
// What Postgres actually hands back is not what we sent.
// ---------------------------------------------------------------------------

check('postgres timestamp format normalises to ISO', () => {
  const back = m.rowToCustomer({
    ...m.customerToRow(customer, USER, ORG),
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
