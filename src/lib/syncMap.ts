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
  Response,
  SharedConfig,
  SignatureRecord,
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

export function customerToRow(customer: Customer, userId: string): Row {
  return {
    id: customer.id,
    customer_name: customer.customerName,
    address: customer.address,
    phone: customer.phone ?? null,
    salesperson: customer.salesperson,
    team_leader: customer.teamLeader,
    job_number: customer.jobNumber ?? null,
    work_scope: customer.workScope ?? null,
    template_ids: customer.templateIds,
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
    location: (row.location as GeoPoint | null) ?? undefined,
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
 * `templateId` is dropped when the checklist is not on the server — the column
 * carries a foreign key, and an inspection must never fail to upload because
 * nobody has synced the checklist library yet. The snapshot holds the real
 * identity of the checklist regardless, which is what reports read.
 */
export function inspectionToRow(
  inspection: Inspection,
  userId: string,
  knownTemplateIds: ReadonlySet<string>,
): Row {
  return {
    id: inspection.id,
    customer_id: inspection.customerId,
    template_id: knownTemplateIds.has(inspection.templateId) ? inspection.templateId : null,
    snapshot: inspection.snapshot ?? {},
    visit_type: inspection.visitType,
    visit_date: inspection.visitDate,
    status: inspection.status,
    info: inspection.info,
    responses: inspection.responses,
    summary_notes: inspection.summaryNotes ?? null,
    inspector_sig: inspection.inspectorSignature ?? null,
    customer_sig: inspection.customerSignature ?? null,
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
    summaryNotes: optionalText(row.summary_notes),
    inspectorSignature: (row.inspector_sig as SignatureRecord | null) ?? undefined,
    customerSignature: (row.customer_sig as SignatureRecord | null) ?? undefined,
    createdBy: optionalText(row.created_by),
    createdAt: iso(row.created_at, now),
    updatedAt: iso(row.updated_at, now),
    completedAt: row.completed_at ? iso(row.completed_at, now) : undefined,
  };
}

// ---------------------------------------------------------------------------
// Photos
// ---------------------------------------------------------------------------

/** Objects are keyed `<inspection_id>/<photo_id>.jpg` to match the bucket policies. */
export function storagePathFor(photo: PhotoRecord): string {
  return `${photo.inspectionId}/${photo.id}.jpg`;
}

export function photoToRow(photo: PhotoRecord, userId: string, storagePath: string): Row {
  return {
    id: photo.id,
    inspection_id: photo.inspectionId,
    question_id: photo.questionId,
    storage_path: storagePath,
    caption: photo.caption ?? null,
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
    createdAt: iso(row.created_at, new Date().toISOString()),
  };
}

// ---------------------------------------------------------------------------
// Templates and the shared config
// ---------------------------------------------------------------------------

export function templateToRow(template: Template, userId: string): Row {
  return {
    id: template.id,
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

export function sharedToRow(shared: SharedConfig): Row {
  return {
    singleton: true,
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
