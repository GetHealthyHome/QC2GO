/**
 * Sync between the device and Supabase.
 *
 * The rule that shapes this file: IndexedDB stays the write path. An inspector
 * in a crawlspace with no signal has to be able to answer a question, take a
 * photo and sign off, so nothing here ever sits in front of a save. Local writes
 * land immediately and leave a note in an outbox; this engine drains that outbox
 * whenever there is a network and an account to push under.
 *
 * Conflicts resolve last-write-wins. Two people editing the same record at the
 * same moment is not a real scenario here — one person walks one job — and the
 * alternative (merge UI, vector clocks) would cost far more than it protects.
 * The one place that is not good enough is a signed inspection, and that is
 * handled by the server: row-level security refuses any edit to a completed
 * record except by an admin, so a stale device cannot overwrite a signed report.
 */
import { useSyncExternalStore } from 'react';
import {
  customersRepo,
  inspectionsRepo,
  outboxRepo,
  photosRepo,
  sharedRepo,
  syncRepo,
  templatesRepo,
} from './db';
import { supabase } from './supabase';
import {
  customerToRow,
  inspectionToRow,
  photoToRow,
  rowToCustomer,
  rowToInspection,
  rowToPhoto,
  rowToShared,
  rowToTemplate,
  sharedToRow,
  storagePathFor,
  templateToRow,
  type Row,
} from './syncMap';
import type { OutboxEntry, PhotoRecord, SyncEntity, SyncState } from './types';

const PHOTO_BUCKET = 'inspection-photos';
const PAGE_SIZE = 200;
/** Give up on an entry the server keeps refusing rather than retry it forever. */
const MAX_ATTEMPTS = 5;

/**
 * Errors that will never come good on a retry — the row is malformed, or the
 * caller is not allowed to write it. Anything else (a dropped connection, a
 * timeout, an expired token) stays queued.
 */
const PERMANENT_CODES = new Set([
  '42501', // insufficient privilege — refused by row-level security
  '23502', // not-null violation
  '23503', // foreign key violation
  '23505', // unique violation
  '23514', // check constraint violation
  '22P02', // invalid text representation
]);

export type SyncPhase = 'disabled' | 'idle' | 'syncing' | 'offline' | 'error';

export interface SyncStatus {
  phase: SyncPhase;
  /** Local changes not yet accepted by the server. */
  pending: number;
  /** Changes the server refused. These need a person, not another retry. */
  rejected: number;
  lastSyncedAt: string | null;
  error: string | null;
  /** Bumped whenever a pull wrote something, so the store knows to reload. */
  revision: number;
}

interface SyncContext {
  userId: string;
  isAdmin: boolean;
  /**
   * The company every row this device writes belongs to. Null when the account
   * has not been invited into one — the server would refuse every write, so the
   * engine stays parked rather than filling the outbox with rejections.
   */
  orgId: string | null;
}

let context: SyncContext | null = null;
let running = false;
/** Set when a sync is requested while one is already in flight. */
let rerun = false;

let status: SyncStatus = {
  phase: 'disabled',
  pending: 0,
  rejected: 0,
  lastSyncedAt: null,
  error: null,
  revision: 0,
};

const listeners = new Set<() => void>();

function emit(patch: Partial<SyncStatus>): void {
  status = { ...status, ...patch };
  for (const listener of listeners) listener();
}

export function subscribeToSync(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getSyncStatus(): SyncStatus {
  return status;
}

/** Status for the UI. `status` is replaced rather than mutated, so this is stable. */
export function useSyncStatus(): SyncStatus {
  return useSyncExternalStore(subscribeToSync, getSyncStatus, getSyncStatus);
}

function online(): boolean {
  return typeof navigator === 'undefined' || navigator.onLine;
}

// ---------------------------------------------------------------------------
// The outbox
// ---------------------------------------------------------------------------

/**
 * Note a local change for upload. Keyed by entity and record, so answering the
 * same question eight times collapses into one upload rather than eight.
 */
export async function enqueue(
  entity: SyncEntity,
  recordId: string,
  op: OutboxEntry['op'],
  storagePath?: string,
): Promise<void> {
  if (!supabase) return;
  const id = `${entity}:${recordId}`;
  await outboxRepo.put({
    id,
    entity,
    recordId,
    op,
    storagePath,
    queuedAt: new Date().toISOString(),
    attempts: 0,
  });
  await refreshCounts();
  scheduleSync();
}

async function refreshCounts(): Promise<void> {
  const entries = await outboxRepo.all();
  emit({
    pending: entries.filter((entry) => !entry.failedAt).length,
    rejected: entries.filter((entry) => entry.failedAt).length,
  });
}

/** Clear the record of refused uploads so they are attempted once more. */
export async function retryRejected(): Promise<void> {
  const entries = await outboxRepo.all();
  await Promise.all(
    entries
      .filter((entry) => entry.failedAt)
      .map((entry) =>
        outboxRepo.put({ ...entry, attempts: 0, failedAt: undefined, lastError: undefined }),
      ),
  );
  await refreshCounts();
  void runSync();
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

let timer: number | undefined;

function scheduleSync(delay = 1500): void {
  if (typeof window === 'undefined') return;
  window.clearTimeout(timer);
  timer = window.setTimeout(() => void runSync(), delay);
}

/**
 * Called when the signed-in account changes. Signing out stops the engine;
 * signing in as someone else resets the pull watermark, because the new account
 * may be allowed to see rows the previous one was not.
 */
export async function configureSync(next: SyncContext | null): Promise<void> {
  const previous = context;
  context = next;

  if (!next) {
    emit({ phase: supabase ? 'idle' : 'disabled', error: null });
    return;
  }
  if (previous && (previous.userId !== next.userId || previous.orgId !== next.orgId)) {
    await syncRepo.reset();
  }
  if (!next.orgId) {
    emit({ phase: 'idle', error: null });
    return;
  }
  await refreshCounts();
  void runSync();
}

/** Wire up the events worth syncing on. Returns a teardown for React. */
export function startSyncTriggers(): () => void {
  if (typeof window === 'undefined') return () => {};

  const onOnline = () => void runSync();
  const onVisible = () => {
    if (document.visibilityState === 'visible') void runSync();
  };
  const interval = window.setInterval(() => void runSync(), 5 * 60 * 1000);

  window.addEventListener('online', onOnline);
  document.addEventListener('visibilitychange', onVisible);

  return () => {
    window.removeEventListener('online', onOnline);
    document.removeEventListener('visibilitychange', onVisible);
    window.clearInterval(interval);
    window.clearTimeout(timer);
  };
}

// ---------------------------------------------------------------------------
// The sync itself
// ---------------------------------------------------------------------------

export async function runSync(): Promise<void> {
  if (!supabase || !context) return;
  if (running) {
    // Something changed mid-flight; go round again rather than dropping it.
    rerun = true;
    return;
  }
  if (!online()) {
    emit({ phase: 'offline' });
    return;
  }

  running = true;
  emit({ phase: 'syncing', error: null });

  try {
    const state = await syncRepo.get();
    if (!state.seededRemote) {
      await adoptLocalData(state);
    }
    await push();
    const pulled = await pull();

    const now = new Date().toISOString();
    await syncRepo.put({ ...(await syncRepo.get()), lastSyncedAt: now });
    emit({
      phase: 'idle',
      lastSyncedAt: now,
      error: null,
      revision: pulled ? status.revision + 1 : status.revision,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    emit({ phase: online() ? 'error' : 'offline', error: message });
    console.error('QC2GO sync failed', error);
  } finally {
    running = false;
    await refreshCounts();
    if (rerun) {
      rerun = false;
      scheduleSync(500);
    }
  }
}

/**
 * First sync on this device for this account: queue everything already here.
 *
 * Without this, records created before the account was connected — or before
 * sync existed at all — would sit on the device forever, because nothing ever
 * put them in the outbox. Checklists are only adopted by admins, since the
 * server refuses template writes from anyone else.
 */
async function adoptLocalData(state: SyncState): Promise<void> {
  const [customers, inspections, photos, templates] = await Promise.all([
    customersRepo.all(),
    inspectionsRepo.all(),
    photosRepo.all(),
    templatesRepo.all(),
  ]);

  // Read the outbox once. A device coming back from a fortnight of field work
  // can hold thousands of records, and re-reading it per record would turn this
  // into a several-second freeze on the first sync after signing in.
  const queued = new Set((await outboxRepo.all()).map((entry) => entry.id));
  const queuedAt = new Date().toISOString();

  const adopt = async (entity: SyncEntity, recordId: string) => {
    const id = `${entity}:${recordId}`;
    if (queued.has(id)) return;
    queued.add(id);
    await outboxRepo.put({ id, entity, recordId, op: 'upsert', queuedAt, attempts: 0 });
  };

  for (const customer of customers) await adopt('customer', customer.id);
  for (const inspection of inspections) await adopt('inspection', inspection.id);
  for (const photo of photos) {
    // Only ours to upload if the bytes are still here.
    if (photo.blob) await adopt('photo', photo.id);
  }
  if (context?.isAdmin) {
    for (const template of templates) await adopt('template', template.id);
    await adopt('shared', 'shared');
  }

  await syncRepo.put({ ...state, seededRemote: true });
}

// ---------------------------------------------------------------------------
// Push
// ---------------------------------------------------------------------------

interface PushError {
  message: string;
  permanent: boolean;
}

function classify(error: { code?: string; message: string } | null): PushError | null {
  if (!error) return null;
  return {
    message: error.message,
    permanent: Boolean(error.code && PERMANENT_CODES.has(error.code)),
  };
}

/**
 * Drain the outbox in dependency order: a checklist before the inspection that
 * points at it, a customer before its inspections, an inspection before its
 * photos. Getting this wrong shows up as foreign key violations.
 */
async function push(): Promise<void> {
  const entries = (await outboxRepo.all()).filter((entry) => !entry.failedAt);
  if (entries.length === 0) return;

  const order: SyncEntity[] = ['shared', 'template', 'customer', 'inspection', 'photo'];

  for (const entity of order) {
    for (const entry of entries.filter((candidate) => candidate.entity === entity)) {
      const failure = await pushOne(entry);
      if (!failure) {
        await outboxRepo.remove(entry.id);
        continue;
      }
      const attempts = entry.attempts + 1;
      if (failure.permanent || attempts >= MAX_ATTEMPTS) {
        // Keep it, flagged, rather than dropping it silently — the Settings
        // screen surfaces the count so the change is not lost without a word.
        await outboxRepo.put({
          ...entry,
          attempts,
          failedAt: new Date().toISOString(),
          lastError: failure.message,
        });
        console.warn(`QC2GO could not upload ${entry.id}: ${failure.message}`);
      } else {
        await outboxRepo.put({ ...entry, attempts, lastError: failure.message });
        // A transient failure will hit the rest of this entity the same way.
        throw new Error(failure.message);
      }
    }
  }
}

/** Which checklists exist on the server, so inspections do not break their FK. */
async function pushOne(entry: OutboxEntry): Promise<PushError | null> {
  const client = supabase!;
  const userId = context!.userId;
  const orgId = context!.orgId!;

  if (entry.op === 'delete') {
    if (entry.entity === 'photo' && entry.storagePath) {
      // The bucket first: a storage object with no row pointing at it is
      // invisible to the app and would just sit there costing money. The path
      // was captured when the delete was queued, since the local record that
      // knew it is already gone by now.
      await client.storage.from(PHOTO_BUCKET).remove([entry.storagePath]);
    }
    const table = tableFor(entry.entity);
    if (!table) return null;
    const { error } = await client.from(table).delete().eq('id', entry.recordId);
    return classify(error);
  }

  switch (entry.entity) {
    case 'customer': {
      const customer = await customersRepo.get(entry.recordId);
      // Deleted locally before it ever went up: nothing left to say.
      if (!customer) return null;
      const { error } = await client
        .from('customers')
        .upsert(customerToRow(customer, userId, orgId));
      return classify(error);
    }
    case 'inspection': {
      const inspection = await inspectionsRepo.get(entry.recordId);
      if (!inspection) return null;
      const { error } = await client
        .from('inspections')
        .upsert(inspectionToRow(inspection, userId, orgId));
      return classify(error);
    }
    case 'photo': {
      const photo = await photosRepo.get(entry.recordId);
      if (!photo?.blob) return null;
      return pushPhoto(photo);
    }
    case 'template': {
      if (!context!.isAdmin) return null;
      const templates = await templatesRepo.all();
      const template = templates.find((candidate) => candidate.id === entry.recordId);
      if (!template) return null;
      const { error } = await client
        .from('templates')
        .upsert(templateToRow(template, userId, orgId), { onConflict: 'org_id,id' });
      return classify(error);
    }
    case 'shared': {
      if (!context!.isAdmin) return null;
      const shared = await sharedRepo.get();
      if (!shared) return null;
      const { error } = await client
        .from('shared_config')
        .upsert(sharedToRow(shared, orgId), { onConflict: 'org_id' });
      return classify(error);
    }
    default:
      return null;
  }
}

/** Bytes to the bucket, then the row that makes them findable. */
async function pushPhoto(photo: PhotoRecord): Promise<PushError | null> {
  const client = supabase!;
  const path = photo.storagePath ?? storagePathFor(photo, context!.orgId!);

  const upload = await client.storage
    .from(PHOTO_BUCKET)
    .upload(path, photo.blob!, { contentType: photo.blob!.type || 'image/jpeg', upsert: true });

  if (upload.error) {
    return { message: upload.error.message, permanent: false };
  }

  const { error } = await client
    .from('photos')
    .upsert(photoToRow(photo, context!.userId, context!.orgId!, path));
  if (error) return classify(error);

  // Remember where it landed so the record can be reunited with its bytes.
  await photosRepo.put({ ...photo, storagePath: path });
  return null;
}

function tableFor(entity: SyncEntity): string | null {
  switch (entity) {
    case 'customer':
      return 'customers';
    case 'inspection':
      return 'inspections';
    case 'photo':
      return 'photos';
    case 'template':
      return 'templates';
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Pull
// ---------------------------------------------------------------------------

/**
 * Fetch everything that changed since the last pull and merge it in. Returns
 * whether anything actually landed, so the UI only reloads when it must.
 *
 * The watermark is the newest `updated_at` the server has handed us, never a
 * local clock reading — a phone whose time is ten minutes fast would otherwise
 * skip straight past rows it had never seen.
 */
async function pull(): Promise<boolean> {
  const state = await syncRepo.get();
  const marks = { ...state.pulledThrough };

  // A record with an unsent local change is not overwritten by the server copy.
  const pendingIds = new Set((await outboxRepo.all()).map((entry) => entry.id));

  const [customers, inspections, photos, templates, tombstones] = await Promise.all([
    fetchSince('customers', 'updated_at', marks.customers),
    fetchSince('inspections', 'updated_at', marks.inspections),
    fetchSince('photos', 'created_at', marks.photos),
    fetchSince('templates', 'updated_at', marks.templates),
    fetchSince('tombstones', 'deleted_at', marks.tombstones),
  ]);

  let changed = false;

  const advance = (table: string, value: unknown) => {
    if (typeof value !== 'string') return;
    const stamp = new Date(value).toISOString();
    if (!marks[table] || stamp > marks[table]) marks[table] = stamp;
  };

  for (const row of customers) {
    advance('customers', row.updated_at);
    const remote = rowToCustomer(row);
    if (pendingIds.has(`customer:${remote.id}`)) continue;
    const local = await customersRepo.get(remote.id);
    if (local && local.updatedAt >= remote.updatedAt) continue;
    await customersRepo.put(remote);
    changed = true;
  }

  for (const row of inspections) {
    advance('inspections', row.updated_at);
    const remote = rowToInspection(row);
    if (pendingIds.has(`inspection:${remote.id}`)) continue;
    const local = await inspectionsRepo.get(remote.id);
    if (local && local.updatedAt >= remote.updatedAt) continue;
    await inspectionsRepo.put(remote);
    changed = true;
  }

  for (const row of photos) {
    advance('photos', row.created_at);
    const remote = rowToPhoto(row);
    if (pendingIds.has(`photo:${remote.id}`)) continue;
    const local = await photosRepo.get(remote.id);
    // Never drop bytes we already hold in favour of a record that has none.
    if (local?.blob) {
      if (!local.storagePath && remote.storagePath) {
        await photosRepo.put({ ...local, storagePath: remote.storagePath });
      }
      continue;
    }
    await photosRepo.put(remote);
    changed = true;
  }

  // Read once rather than per row: the checklist library is small but this loop
  // would otherwise re-read all of it for every checklist that changed.
  const localTemplates = new Map((await templatesRepo.all()).map((t) => [t.id, t]));
  for (const row of templates) {
    advance('templates', row.updated_at);
    const remote = rowToTemplate(row);
    if (pendingIds.has(`template:${remote.id}`)) continue;
    const local = localTemplates.get(remote.id);
    if (local && (local.updatedAt ?? '') >= (remote.updatedAt ?? '')) continue;
    await templatesRepo.put(remote);
    changed = true;
  }

  if (await pullShared(pendingIds)) changed = true;

  // Deletes last: applying them after the upserts means a row that was deleted
  // and re-created in the same window ends up correct either way.
  for (const row of tombstones) {
    advance('tombstones', row.deleted_at);
    if (await applyTombstone(row, pendingIds)) changed = true;
  }

  await syncRepo.put({ ...(await syncRepo.get()), pulledThrough: marks });
  return changed;
}

/**
 * One row, so there is no watermark to keep — it is always read and compared
 * against what the device holds.
 */
async function pullShared(pendingIds: Set<string>): Promise<boolean> {
  if (pendingIds.has('shared:shared')) return false;
  // One row per company, and row-level security only ever shows this account
  // its own — so "the first row I can see" is the right one by construction.
  const { data, error } = await supabase!
    .from('shared_config')
    .select('*')
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return false;

  const remote = rowToShared(data as Row);
  const local = await sharedRepo.get();
  if (local && local.updatedAt >= remote.updatedAt) return false;
  await sharedRepo.put(remote);
  return true;
}

async function applyTombstone(row: Row, pendingIds: Set<string>): Promise<boolean> {
  const entity = String(row.entity);
  const id = String(row.entity_id);
  const deletedAt = typeof row.deleted_at === 'string' ? new Date(row.deleted_at).toISOString() : '';

  switch (entity) {
    case 'customer': {
      if (pendingIds.has(`customer:${id}`)) return false;
      const local = await customersRepo.get(id);
      // Re-created here since the delete happened; keep what is on the device.
      if (!local || local.updatedAt > deletedAt) return false;
      await customersRepo.remove(id);
      return true;
    }
    case 'inspection': {
      if (pendingIds.has(`inspection:${id}`)) return false;
      const local = await inspectionsRepo.get(id);
      if (!local || local.updatedAt > deletedAt) return false;
      await inspectionsRepo.remove(id);
      return true;
    }
    case 'photo': {
      if (pendingIds.has(`photo:${id}`)) return false;
      const local = await photosRepo.get(id);
      if (!local) return false;
      await photosRepo.remove(id);
      return true;
    }
    case 'template': {
      if (pendingIds.has(`template:${id}`)) return false;
      await templatesRepo.remove(id);
      return true;
    }
    default:
      return false;
  }
}

/** Paged read of one table, oldest change first so the watermark moves forward. */
async function fetchSince(
  table: string,
  column: string,
  since: string | undefined,
): Promise<Row[]> {
  const rows: Row[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    let query = supabase!.from(table).select('*').order(column, { ascending: true });
    // `gte` rather than `gt`: re-reading the boundary row costs nothing, and it
    // closes the window where two rows share a timestamp and one is missed.
    if (since) query = query.gte(column, since);

    const { data, error } = await query.range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...((data ?? []) as Row[]));
    if (!data || data.length < PAGE_SIZE) break;
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Photo bytes, fetched on demand
// ---------------------------------------------------------------------------

/**
 * Pull down the bytes for a photo that arrived as a record only, and keep them
 * so the next look is instant and works offline. Called from the store when
 * something is about to render the image.
 */
export async function fetchPhotoBlob(photo: PhotoRecord): Promise<PhotoRecord | undefined> {
  if (photo.blob || !photo.storagePath || !supabase || !online()) return photo;

  const { data, error } = await supabase.storage.from(PHOTO_BUCKET).download(photo.storagePath);
  if (error || !data) {
    console.warn('QC2GO could not download photo', photo.id, error);
    return photo;
  }
  const filled: PhotoRecord = { ...photo, blob: data };
  await photosRepo.put(filled);
  return filled;
}
