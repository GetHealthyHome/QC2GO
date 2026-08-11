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
  /** Prefill from the parent job record when a new inspection is created. */
  fromJob?: keyof Job;
  /** Half-width on the two-column form grid. */
  half?: boolean;
}

export type TemplateCategory =
  | 'home-performance'
  | 'indoor-air-quality'
  | 'mitsubishi-ducted'
  | 'mitsubishi-ductless'
  | 'quilt';

export interface Template {
  id: string;
  name: string;
  category: TemplateCategory;
  summary: string;
  /** Template-specific sections. The shared sections are prepended at runtime. */
  sections: Section[];
}

export type VisitType = 'site-visit' | 'final-walkthrough' | 'punch-recheck';

export interface Job {
  id: string;
  /** The organizing key for the whole app. */
  name: string;
  customerName: string;
  address: string;
  salesperson: string;
  teamLeader: string;
  phone?: string;
  jobNumber?: string;
  notes?: string;
  archived?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Response {
  answer: Answer | null;
  /** Required when the answer is No; optional otherwise. */
  note?: string;
  /** Photo record ids held in the `photos` store. */
  photoIds: string[];
  /** Recorded value for measurement / text questions. */
  value?: string;
  /** Set once the deficiency has been corrected on a re-check. */
  resolved?: boolean;
  answeredAt?: string;
}

export interface SignatureRecord {
  name: string;
  /** PNG data URL from the signature canvas. */
  dataUrl: string;
  signedAt: string;
}

export type InspectionStatus = 'in-progress' | 'completed';

export interface Inspection {
  id: string;
  jobId: string;
  templateId: string;
  visitType: VisitType;
  status: InspectionStatus;
  /** Values for the shared job-information fields, keyed by FieldDef id. */
  info: Record<string, string>;
  responses: Record<string, Response>;
  summaryNotes?: string;
  inspectorSignature?: SignatureRecord;
  customerSignature?: SignatureRecord;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

export interface PhotoRecord {
  id: string;
  inspectionId: string;
  questionId: string;
  blob: Blob;
  caption?: string;
  createdAt: string;
}

export interface Settings {
  inspectorName: string;
  companyName: string;
}
