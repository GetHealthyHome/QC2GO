/**
 * Translation between the app's records and the database's rows.
 *
 * The two shapes differ on purpose. The app is camelCase and stores photo bytes;
 * PostgreSQL is snake_case and keeps bytes in a storage bucket. Keeping the
 * mapping in one file means a column rename is a compile error here rather than
 * a silent null somewhere in the sync engine.
 */
import type {
  Customer,
  GeoPoint,
  Inspection,
  InspectionStatus,
  PhotoRecord,
  ReopenRecord,
  Response,
  SharedConfig,
  SignatureRecord,
  Task,
  TaskEvent,
  Template,
  VisitType,
} from './types';

/** A row on its way to or from PostgREST. */
export type Row = Record<string, unknown>;

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function optionalText(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function instanceMap(value: unknown): Inspection['sectionInstances'] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  // Absent rather than empty, so an inspection with no repeatable sections
  // round-trips to exactly what it started as.
  return Object.keys(value).length === 0
    ? undefined
    : (value as Inspection['sectionInstances']);
}

function annotationList(value: unknown): PhotoRecord['annotations'] {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  return value as PhotoRecord['annotations'];
}

function resolutionMap(value: unknown): Customer['punchResolutions'] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const entries = Object.entries(value as Record<string, unknown>);
  // Absent rather than empty, so a customer with nothing closed out round-trips
  // to exactly what it started as.
  return entries.length === 0 ? undefined : (value as Customer['punchResolutions']);
}

function reopenList(value: unknown): ReopenRecord[] | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  return value as ReopenRecord[];
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

/** Postgres hands back `timestamptz` in its own format; the app compares ISO strings. */
function iso(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed.toISOString();
}

// ---------------------------------------------------------------------------
// Customers
// ---------------------------------------------------------------------------

export function customerToRow(customer: Customer, userId: string, orgId: string): Row {
  return {
    id: customer.id,
    org_id: orgId,
    customer_name: customer.customerName,
    address: customer.address,
    phone: customer.phone ?? null,
    salesperson: customer.salesperson,
    team_leader: customer.teamLeader,
    job_number: customer.jobNumber ?? null,
    work_scope: customer.workScope ?? null,
    template_ids: customer.templateIds,
    punch_resolutions: customer.punchResolutions ?? {},
    location: customer.location ?? null,
    archived: customer.archived ?? false,
    // Whoever first created it keeps it. The insert policy checks this against
    // the caller, so a record created by someone else is not ours to re-insert.
    created_by: customer.createdBy ?? userId,
    created_at: customer.createdAt,
    updated_at: customer.updatedAt,
  };
}

export function rowToCustomer(row: Row): Customer {
  const now = new Date().toISOString();
  return {
    id: text(row.id),
    customerName: text(row.customer_name),
    address: text(row.address),
    phone: optionalText(row.phone),
    salesperson: text(row.salesperson),
    teamLeader: text(row.team_leader),
    jobNumber: optionalText(row.job_number),
    workScope: optionalText(row.work_scope),
    templateIds: stringArray(row.template_ids),
    punchResolutions: resolutionMap(row.punch_resolutions),
    location: (row.location as GeoPoint | null) ?? undefined,
    archived: row.archived === true,
    createdBy: optionalText(row.created_by),
    createdAt: iso(row.created_at, now),
    updatedAt: iso(row.updated_at, now),
  };
}

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

/**
 * The history is the answer to "who moved this and when", so it round-trips as
 * a list rather than being flattened to the latest entry. A row that arrives
 * without one is given an empty list, never `undefined` — every reader appends
 * to it.
 */
function taskHistory(value: unknown): TaskEvent[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is TaskEvent => !!entry && typeof entry === 'object');
}

export function taskToRow(task: Task, userId: string, orgId: string): Row {
  return {
    id: task.id,
    org_id: orgId,
    customer_id: task.customerId,
    inspection_id: task.inspectionId ?? null,
    punch_key: task.punchKey ?? null,
    title: task.title,
    detail: task.detail ?? null,
    state: task.state,
    assignee: task.assignee ?? null,
    critical: task.critical ?? false,
    due_date: task.dueDate ?? null,
    history: task.history,
    archived: task.archived ?? false,
    created_by: task.createdBy ?? userId,
    created_at: task.createdAt,
    updated_at: task.updatedAt,
  };
}

export function rowToTask(row: Row): Task {
  const now = new Date().toISOString();
  return {
    id: text(row.id),
    customerId: text(row.customer_id),
    inspectionId: optionalText(row.inspection_id),
    punchKey: optionalText(row.punch_key),
    title: text(row.title),
    detail: optionalText(row.detail),
    state: (text(row.state) || 'new') as Task['state'],
    assignee: optionalText(row.assignee),
    critical: row.critical === true ? true : undefined,
    dueDate: optionalText(row.due_date),
    history: taskHistory(row.history),
    archived: row.archived === true,
    createdBy: optionalText(row.created_by),
    createdAt: iso(row.created_at, now),
    updatedAt: iso(row.updated_at, now),
  };
}

// ---------------------------------------------------------------------------
// Inspections
// ---------------------------------------------------------------------------

/**
 * `templateId` travels as written. It used to be nulled out whenever the
 * checklist had not reached the server yet, because the column carried a
 * foreign key and an inspection must never fail to upload behind a checklist
 * nobody has synced. 0004 dropped that constraint — the snapshot holds the real
 * identity of the checklist, which is what reports read — so the id can simply
 * be told the truth.
 */
export function inspectionToRow(inspection: Inspection, userId: string, orgId: string): Row {
  return {
    id: inspection.id,
    org_id: orgId,
    customer_id: inspection.customerId,
    template_id: inspection.templateId || null,
    snapshot: inspection.snapshot ?? {},
    visit_type: inspection.visitType,
    visit_date: inspection.visitDate,
    status: inspection.status,
    info: inspection.info,
    responses: inspection.responses,
    section_instances: inspection.sectionInstances ?? {},
    summary_notes: inspection.summaryNotes ?? null,
    inspector_sig: inspection.inspectorSignature ?? null,
    customer_sig: inspection.customerSignature ?? null,
    reopenings: inspection.reopenings ?? [],
    overall_score: inspection.overallScore ?? null,
    pass_fail_status: inspection.passFailStatus ?? null,
    total_deficiencies: inspection.totalDeficiencies ?? null,
    created_by: inspection.createdBy ?? userId,
    created_at: inspection.createdAt,
    updated_at: inspection.updatedAt,
    completed_at: inspection.completedAt ?? null,
  };
}

export function rowToInspection(row: Row): Inspection {
  const now = new Date().toISOString();
  const snapshot = row.snapshot as Inspection['snapshot'] | null;
  return {
    id: text(row.id),
    customerId: text(row.customer_id),
    // A null column means the checklist was never uploaded; the snapshot still
    // names it, so fall back to that rather than losing the link entirely.
    templateId: optionalText(row.template_id) ?? snapshot?.templateId ?? '',
    snapshot: snapshot ?? undefined,
    visitType: text(row.visit_type) as VisitType,
    visitDate: text(row.visit_date),
    status: text(row.status) as InspectionStatus,
    info: (row.info as Record<string, string> | null) ?? {},
    responses: (row.responses as Record<string, Response> | null) ?? {},
    sectionInstances: instanceMap(row.section_instances),
    summaryNotes: optionalText(row.summary_notes),
    inspectorSignature: (row.inspector_sig as SignatureRecord | null) ?? undefined,
    customerSignature: (row.customer_sig as SignatureRecord | null) ?? undefined,
    // Absent rather than empty when there are none, so an inspection that was
    // never reopened round-trips to exactly what it started as.
    reopenings: reopenList(row.reopenings),
    overallScore: typeof row.overall_score === 'number' ? row.overall_score : undefined,
    passFailStatus: (optionalText(row.pass_fail_status) as Inspection['passFailStatus']) ?? undefined,
    totalDeficiencies:
      typeof row.total_deficiencies === 'number' ? row.total_deficiencies : undefined,
    createdBy: optionalText(row.created_by),
    createdAt: iso(row.created_at, now),
    updatedAt: iso(row.updated_at, now),
    completedAt: row.completed_at ? iso(row.completed_at, now) : undefined,
  };
}

// ---------------------------------------------------------------------------
// Photos
// ---------------------------------------------------------------------------

/**
 * Objects are keyed `<org_id>/<inspection_id>/<photo_id>.jpg`.
 *
 * The organization comes first because that is what the bucket policy reads:
 * a caller may touch an object only when the first path segment is their own
 * company. Without that prefix the whole bucket is one guessed path away from
 * anybody with an account.
 */
export function storagePathFor(photo: PhotoRecord, orgId: string): string {
  return `${orgId}/${photo.inspectionId}/${photo.id}.jpg`;
}

export function photoToRow(
  photo: PhotoRecord,
  userId: string,
  orgId: string,
  storagePath: string,
): Row {
  return {
    id: photo.id,
    org_id: orgId,
    inspection_id: photo.inspectionId,
    question_id: photo.questionId,
    storage_path: storagePath,
    caption: photo.caption ?? null,
    taken_at: photo.takenAt ?? null,
    gps: photo.gps ?? null,
    gps_source: photo.gpsSource ?? null,
    watermarked: photo.watermarked ?? false,
    annotations: photo.annotations ?? [],
    created_by: userId,
    created_at: photo.createdAt,
  };
}

/** No `blob`: the bytes stay on the server until something renders the photo. */
export function rowToPhoto(row: Row): PhotoRecord {
  return {
    id: text(row.id),
    inspectionId: text(row.inspection_id),
    questionId: text(row.question_id),
    storagePath: optionalText(row.storage_path),
    caption: optionalText(row.caption),
    takenAt: optionalText(row.taken_at),
    gps: (row.gps as PhotoRecord['gps'] | null) ?? undefined,
    gpsSource: (optionalText(row.gps_source) as PhotoRecord['gpsSource']) ?? undefined,
    watermarked: row.watermarked === true ? true : undefined,
    annotations: annotationList(row.annotations),
    createdAt: iso(row.created_at, new Date().toISOString()),
  };
}

// ---------------------------------------------------------------------------
// Templates and the shared config
// ---------------------------------------------------------------------------

export function templateToRow(template: Template, userId: string, orgId: string): Row {
  return {
    id: template.id,
    org_id: orgId,
    name: template.name,
    category: template.category,
    summary: template.summary,
    sections: template.sections,
    built_in: template.builtIn ?? false,
    archived: template.archived ?? false,
    version: template.version ?? 1,
    created_by: userId,
    created_at: template.createdAt ?? new Date().toISOString(),
    updated_at: template.updatedAt ?? new Date().toISOString(),
  };
}

export function rowToTemplate(row: Row): Template {
  const now = new Date().toISOString();
  return {
    id: text(row.id),
    name: text(row.name),
    category: text(row.category) || 'custom',
    summary: text(row.summary),
    sections: (row.sections as Template['sections'] | null) ?? [],
    builtIn: row.built_in === true,
    archived: row.archived === true,
    version: typeof row.version === 'number' ? row.version : 1,
    createdAt: iso(row.created_at, now),
    updatedAt: iso(row.updated_at, now),
  };
}

export function sharedToRow(shared: SharedConfig, orgId: string): Row {
  return {
    // One row per company: 0004 replaced the `singleton` pin with the org id.
    org_id: orgId,
    info_fields: shared.infoFields,
    universal_section: shared.universalSection,
    salespeople: shared.salespeople,
    team_leaders: shared.teamLeaders,
    updated_at: shared.updatedAt,
  };
}

export function rowToShared(row: Row): SharedConfig {
  return {
    infoFields: (row.info_fields as SharedConfig['infoFields'] | null) ?? [],
    universalSection: (row.universal_section as SharedConfig['universalSection']) ?? {
      id: 'universal',
      title: 'Universal QC Standards',
      questions: [],
    },
    salespeople: stringArray(row.salespeople),
    teamLeaders: stringArray(row.team_leaders),
    updatedAt: iso(row.updated_at, new Date().toISOString()),
  };
}
