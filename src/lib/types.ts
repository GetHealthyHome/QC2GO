/** Core domain model for QC2GO. */

/** The three-state answer every checklist question uses. */
export type Answer = 'yes' | 'no' | 'na';

export type QuestionKind =
  /** Yes / No / N-A — the standard QC item. */
  | 'yesno'
  /** A measured value the inspector records (static pressure, delta-T, CFM50...). */
  | 'measurement'
  /** Free text (serial numbers, crew notes). */
  | 'text';

export interface Question {
  id: string;
  text: string;
  /** Short guidance shown under the question — the "what good looks like" line. */
  help?: string;
  kind?: QuestionKind;
  /** Unit label for measurement questions, e.g. "in. w.c." or "°F". */
  unit?: string;
  /** Failing this item blocks sign-off entirely rather than becoming a punch item. */
  critical?: boolean;
  /** Require a photo even when the answer is Yes (equipment tags, gauges, test screens). */
  photoOnPass?: boolean;
}

export interface Section {
  id: string;
  title: string;
  description?: string;
  questions: Question[];
}

export type FieldType = 'text' | 'textarea' | 'date' | 'select' | 'number' | 'tel';

export interface FieldDef {
  id: string;
  label: string;
  type: FieldType;
  required?: boolean;
  options?: string[];
  placeholder?: string;
  /** Prefill from the parent customer record when a new inspection is created. */
  fromJob?: 'customerName' | 'address' | 'salesperson' | 'teamLeader' | 'jobNumber' | 'phone';
  /** Half-width on the two-column form grid. */
  half?: boolean;
}

/** Free-form so an admin can introduce a system type without a code change. */
export type TemplateCategory = string;

export interface Template {
  id: string;
  name: string;
  category: TemplateCategory;
  summary: string;
  /** Template-specific sections. The shared sections are prepended at runtime. */
  sections: Section[];
  /** Seeded from code. Built-ins can be edited, but reset restores them. */
  builtIn?: boolean;
  archived?: boolean;
  /** Bumped on every admin edit; stamped into the inspection snapshot. */
  version?: number;
  createdAt?: string;
  updatedAt?: string;
}

/**
 * The blocks every checklist shares. Editable by admins in one place so a new
 * company-wide standard lands on all checklists at once.
 */
export interface SharedConfig {
  infoFields: FieldDef[];
  universalSection: Section;
  /** Admin-maintained pick lists so field staff choose rather than type. */
  salespeople: string[];
  teamLeaders: string[];
  updatedAt: string;
}

/**
 * What the checklist looked like when the inspection was started. A signed QC
 * record must not change because an admin later reworded a question, so the
 * inspection carries its own copy rather than pointing at the live template.
 */
export interface TemplateSnapshot {
  templateId: string;
  templateName: string;
  templateVersion: number;
  infoFields: FieldDef[];
  sections: Section[];
  capturedAt: string;
}

export type VisitType = 'site-visit' | 'final-walkthrough' | 'punch-recheck';

/** Where a job is, captured on site. Addresses are not geocoded — see lib/geo.ts. */
export interface GeoPoint {
  lat: number;
  lng: number;
  /** Metres of GPS uncertainty reported by the device. */
  accuracy?: number;
  capturedAt: string;
}

/**
 * The organizing record for the whole app. One project per customer: everything
 * — every visit, every checklist, every QC card — hangs off this.
 */
export interface Customer {
  id: string;
  customerName: string;
  address: string;
  salesperson: string;
  teamLeader: string;
  phone?: string;
  jobNumber?: string;
  /** Scope of work plus any access notes. */
  workScope?: string;
  /** Checklists that apply to this job, chosen when the customer is created. */
  templateIds: string[];
  location?: GeoPoint;
  /**
   * Punch items corrected on a later visit, keyed by `punchKey`. Spans every
   * inspection on this customer, which is the level the punch list works at.
   */
  punchResolutions?: Record<string, PunchResolution>;
  archived?: boolean;
  /** Account that created the record. Set by sync; absent on local-only data. */
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * A punch item that has been corrected.
 *
 * Held on the customer rather than on the response it refers to. A signed
 * inspection is a record — rewriting a response inside one to say "fixed" would
 * walk through every guarantee the app makes about that, and invisibly. A
 * resolution is a new fact, not an edit of an old one.
 */
export interface PunchResolution {
  at: string;
  /** Who marked it corrected. Absent on local-only data. */
  by?: string;
  note?: string;
}

/** Keys a resolution to the checkpoint it closes, across inspections. */
export function punchKey(inspectionId: string, questionId: string): string {
  return `${inspectionId}:${questionId}`;
}

export interface Response {
  answer: Answer | null;
  /** Required when the answer is No; optional otherwise. */
  note?: string;
  /** Photo record ids held in the `photos` store. */
  photoIds: string[];
  /** Recorded value for measurement / text questions. */
  value?: string;
  answeredAt?: string;
}

export interface SignatureRecord {
  name: string;
  /** PNG data URL from the signature canvas. */
  dataUrl: string;
  signedAt: string;
}

export type InspectionStatus = 'in-progress' | 'completed';

/**
 * One unlocking of a signed inspection.
 *
 * Captured on the record rather than sent to a server, because the app has to
 * work with no signal — and because a reason that only exists on a server is
 * one an inspector reading the report in a basement cannot see. The server
 * keeps its own copy in an append-only ledger when the change syncs up, which
 * is the half that cannot be edited away.
 */
export interface ReopenRecord {
  reason: string;
  at: string;
  /** Account that reopened it. Absent on local-only data. */
  by?: string;
}

export interface Inspection {
  id: string;
  customerId: string;
  templateId: string;
  /** Absent on inspections created before snapshots existed; resolved by id then. */
  snapshot?: TemplateSnapshot;
  visitType: VisitType;
  /**
   * The day this inspection covers, as YYYY-MM-DD. Jobs run across several days
   * with a different area of focus each day, so QC cards group by this.
   */
  visitDate: string;
  status: InspectionStatus;
  /** Values for the shared job-information fields, keyed by FieldDef id. */
  info: Record<string, string>;
  responses: Record<string, Response>;
  summaryNotes?: string;
  inspectorSignature?: SignatureRecord;
  customerSignature?: SignatureRecord;
  /** Every time this record was unlocked after signing, and why. Append-only. */
  reopenings?: ReopenRecord[];
  /**
   * The result, written at sign-off for everything outside the app to read —
   * a webhook body, a spreadsheet, a dashboard. Absent while in progress,
   * which is the honest state: there is no result yet.
   *
   * Inside the app the score is still derived from the responses on every
   * read. Two copies of a number is a risk; the alternative was two
   * implementations of the rule, which is a worse one.
   */
  overallScore?: number;
  passFailStatus?: 'PASS' | 'FAIL' | 'NEEDS_REVIEW';
  totalDeficiencies?: number;
  /** Account that ran the inspection. The server only lets its author edit it. */
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

export interface PhotoRecord {
  id: string;
  inspectionId: string;
  questionId: string;
  /**
   * Absent on a photo that arrived from another device. Photos are the heaviest
   * thing the app moves, so a pull takes the record and leaves the bytes on the
   * server until something actually renders them.
   */
  blob?: Blob;
  /** Key in the `inspection-photos` bucket, set once the file has been uploaded. */
  storagePath?: string;
  caption?: string;
  /**
   * When the shutter fired, read from the file's own metadata before anything
   * re-encoded it. Absent when the camera recorded none — which is common, and
   * is why `createdAt` is not the same thing.
   */
  takenAt?: string;
  /** Where the photo was taken, if anything could say. */
  gps?: { lat: number; lng: number };
  /**
   * Whether the coordinates came from the camera or from this device at the
   * moment of capture. Worth keeping apart: one is what the camera claims about
   * the photo, the other is where the phone was when it was saved.
   */
  gpsSource?: 'exif' | 'device';
  /** False when the browser could not decode the image and the original was kept. */
  watermarked?: boolean;
  createdAt: string;
}

/** What the sync engine moves, and the local record it maps to. */
export type SyncEntity = 'customer' | 'inspection' | 'photo' | 'template' | 'shared';

/**
 * A local change waiting to reach the server. Keyed `<entity>:<recordId>` so a
 * question answered eight times collapses to one upload rather than eight.
 */
export interface OutboxEntry {
  id: string;
  entity: SyncEntity;
  recordId: string;
  op: 'upsert' | 'delete';
  queuedAt: string;
  attempts: number;
  /**
   * Where the photo's bytes live. Captured when the delete is queued, because by
   * the time it is sent the local record is already gone.
   */
  storagePath?: string;
  /** Set when the server refused the change for a reason retrying will not fix. */
  failedAt?: string;
  lastError?: string;
}

/** Where the last pull got to, so the next one only asks for what changed. */
export interface SyncState {
  /**
   * Watermark per table, as the newest timestamp the server has handed us.
   * Per table rather than one shared value: the tables are read concurrently, so
   * a single watermark taken from the fastest of them could jump past a row
   * another table was still writing.
   */
  pulledThrough: Record<string, string>;
  lastSyncedAt: string | null;
  /** Set once this device has offered what it already holds to the server. */
  seededRemote: boolean;
}

/**
 * Inspectors run checklists and read past reports. Admins also build and edit
 * them. An owner is the person who answers for the company: everything an admin
 * can do, plus managing who is in it.
 *
 * Enforced locally as a UI mode only — the real boundary is Supabase RLS. Owner
 * is never chosen on a device; it only ever arrives from a signed-in profile.
 */
export type Role = 'owner' | 'admin' | 'inspector';

/** Owners are admins with extra rights, so every admin check has to say so. */
export function hasAdminRights(role: Role): boolean {
  return role === 'owner' || role === 'admin';
}

/**
 * The company a signed-in person belongs to. One organization per account: an
 * inspector works for one company, and keeping the boundary a single value
 * keeps every server-side policy a single comparison.
 */
export interface Organization {
  id: string;
  name: string;
  slug: string;
  /**
   * The company logo as an image data URL, sized for the report letterhead.
   * Stored inline rather than in a bucket so a report can be printed with no
   * network — see `supabase/migrations/0005_branding.sql`.
   */
  logo?: string | null;
}

export interface Settings {
  inspectorName: string;
  companyName: string;
  role: Role;
}
