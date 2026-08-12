/** Core domain model for QC2GO. */
import type { Annotation } from './annotate';

export type { Annotation };

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
  /**
   * This checkpoint records equipment codes — serial and model numbers — and
   * offers the camera as a way to capture them.
   *
   * A flag rather than a fourth question kind on purpose. The QC question on a
   * serial checkpoint is still a yes/no one ("were they recorded and
   * photographed?") and it still scores; what was missing was anywhere to put
   * the numbers themselves. They live in `Response.value`, the same field a
   * measurement uses, so they export, sync and appear in the payload without
   * anything new having to learn about them.
   */
  scannable?: boolean;
  /** Ask this only when another checkpoint was answered a particular way. */
  showIf?: Condition;
  /**
   * A fact about the job rather than a standard it has to meet.
   *
   * "Gas-fired appliance on site" is the shape of question a condition hangs
   * off, and answering it No is not a deficiency — it is the answer. Without
   * this, routing questions are unusable: every electric job would score a
   * failure, demand a photograph of the absent appliance, and refuse to be
   * signed until somebody explained why there wasn't one.
   *
   * So it is asked and answered like any yes/no checkpoint, and it still has to
   * be answered before sign-off — a forgotten router silently skips everything
   * downstream of it — but it is not scored and never becomes a punch item.
   */
  informational?: boolean;
}

/**
 * "Ask this only when that was answered so."
 *
 * One level deep, deliberately. The TRD specifies nested chains and
 * score-triggered reveals; almost all of the value is in the first level — *if
 * there is no gas appliance, do not ask twelve combustion questions* — and each
 * further level multiplies the ways a checklist can be authored into a state
 * where a question can never be reached and nobody notices.
 *
 * The controlling checkpoint is named by id rather than by position so that
 * reordering a section cannot silently repoint a condition at a different
 * question.
 */
export interface Condition {
  /** The checkpoint whose answer decides this. */
  questionId: string;
  /**
   * Shown when that checkpoint's answer is one of these.
   *
   * Unanswered is not one of them: a conditional block appears once the question
   * it depends on has been answered, and until then it is neither asked nor
   * counted. That is the behaviour that makes the checklist shorter rather than
   * merely differently shaped.
   */
  answerIn: Answer[];
}

export interface Section {
  id: string;
  title: string;
  description?: string;
  questions: Question[];
  /**
   * Run this section once per thing rather than once per inspection: per indoor
   * head, per zone, per room. A ductless job with five heads asks the same
   * questions five times, and the alternative — five hand-authored copies of
   * the same section — loses which head actually failed.
   */
  repeatable?: boolean;
  /** What one of them is called. "Head", "Zone", "Room". Defaults to "Item". */
  instanceNoun?: string;
  /** Run this whole section only when another checkpoint was answered a particular way. */
  showIf?: Condition;
}

/**
 * One occurrence of a repeatable section within an inspection.
 *
 * Instances belong to the inspection rather than to the snapshot: the checklist
 * says a section repeats, and the inspector decides how many times while
 * standing in the building.
 */
export interface SectionInstance {
  id: string;
  /** What the inspector called it — "Primary bedroom", "Zone 2". Optional. */
  label?: string;
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
  /**
   * Whether a work order has to be verified by somebody other than the account
   * that marked it done.
   *
   * A company decision rather than ours. Some crews want a second pair of eyes
   * on every correction; a two-person company enforcing that would deadlock on
   * its own rule. Off by default, which keeps self-verification possible and
   * merely recorded — turning it on makes it refused instead.
   *
   * It can only bite where accounts exist. In local mode nothing is signed in,
   * so there is no second person to be, and the rule stands down rather than
   * locking the board.
   */
  requireSecondVerifier?: boolean;
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
  /**
   * Keyed by question id, or `<questionId>#<instanceId>` inside a repeatable
   * section — see `responseKey`. A flat map rather than a nested one so that
   * every inspection signed before repeatable sections existed still reads
   * exactly as it did.
   */
  responses: Record<string, Response>;
  /** Instances of each repeatable section, keyed by section id. */
  sectionInstances?: Record<string, SectionInstance[]>;
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
  /**
   * Marks drawn over the photo to point at what is wrong. Held beside the image
   * rather than burned into it, so the evidence stays as the camera produced it
   * and a mark in the wrong place can be moved. See `lib/annotate.ts`.
   */
  annotations?: Annotation[];
  createdAt: string;
}

/**
 * The TRD's work-order lifecycle, in order.
 *
 * Six states is more than a small crew needs to describe a job, and that is the
 * point of two of them: `done` is the claim that the work is finished and
 * `verified` is somebody else having looked. Collapsing those two is exactly the
 * thing a QC app exists not to do.
 */
export type TaskState = 'new' | 'assigned' | 'todo' | 'in-progress' | 'done' | 'verified';

/** One state change, kept so the record says who moved it and when. */
export interface TaskEvent {
  at: string;
  /** Account that made the change. Absent on local-only data. */
  by?: string;
  to: TaskState;
  note?: string;
}

/**
 * A piece of work somebody owns.
 *
 * Two kinds live in the same record. Most tasks correct a punch item — a
 * checkpoint that was failed — and carry `punchKey` back to it. The rest are
 * standalone work orders raised against a customer with no failed checkpoint
 * behind them: order the part, book the crane, come back when the drywall is up.
 *
 * A task never copies the checkpoint's wording. The punch list reads that back
 * out of the inspection's frozen snapshot, and a second copy here would drift
 * from the record that was actually signed.
 */
export interface Task {
  id: string;
  customerId: string;
  /** The punch item this exists to correct, if it came from one. */
  punchKey?: string;
  /** The inspection that raised it, for the link back to where it failed. */
  inspectionId?: string;
  title: string;
  detail?: string;
  state: TaskState;
  /** A name from the admin-maintained roster, not an account. */
  assignee?: string;
  /**
   * What to look for before calling this verified.
   *
   * The person re-checking work is often not the person who did it, and on a
   * correction from three weeks ago they may never have seen the original
   * failure. For a task raised from a checkpoint this starts as that
   * checkpoint's own guidance — the "what good looks like" line an admin
   * already wrote on the checklist — rather than as something somebody has to
   * think of again while standing in a basement.
   */
  verifyCriteria?: string;
  /** Raised from a checkpoint the checklist marks critical. */
  critical?: boolean;
  /** `YYYY-MM-DD`, as typed — no time zone to get wrong. */
  dueDate?: string;
  history: TaskEvent[];
  /** Account that created the record. Absent on local-only data. */
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
  archived?: boolean;
}

/** What the sync engine moves, and the local record it maps to. */
export type SyncEntity = 'customer' | 'inspection' | 'photo' | 'template' | 'shared' | 'task';

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
