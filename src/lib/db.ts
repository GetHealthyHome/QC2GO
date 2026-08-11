import type {
  Customer,
  Inspection,
  OutboxEntry,
  PhotoRecord,
  Settings,
  SharedConfig,
  SyncState,
  Template,
} from './types';

/**
 * Everything lives in IndexedDB so an inspection survives a dead cell signal in a
 * crawlspace, a backgrounded tab, or a phone that reboots mid-walkthrough.
 *
 * This stays the write path even with a backend configured. Sync reads out of
 * here and pushes; it never sits in front of a save.
 */
const DB_NAME = 'qc2go';
const DB_VERSION = 4;

export const STORES = {
  customers: 'customers',
  inspections: 'inspections',
  photos: 'photos',
  settings: 'settings',
  templates: 'templates',
  outbox: 'outbox',
} as const;

type StoreName = (typeof STORES)[keyof typeof STORES];

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORES.customers)) {
        db.createObjectStore(STORES.customers, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORES.inspections)) {
        const store = db.createObjectStore(STORES.inspections, { keyPath: 'id' });
        store.createIndex('customerId', 'customerId', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORES.photos)) {
        const store = db.createObjectStore(STORES.photos, { keyPath: 'id' });
        store.createIndex('inspectionId', 'inspectionId', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORES.settings)) {
        db.createObjectStore(STORES.settings, { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains(STORES.templates)) {
        db.createObjectStore(STORES.templates, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORES.outbox)) {
        db.createObjectStore(STORES.outbox, { keyPath: 'id' });
      }
      if (event.oldVersion > 0 && event.oldVersion < 3 && request.transaction) {
        migrateJobsToCustomers(db, request.transaction);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return dbPromise;
}

/**
 * v2 stored jobs keyed by a job name; v3 reorganised around the customer.
 * Anything already on a device is carried across rather than dropped: the job
 * name is discarded, and inspections gain the customer link and a visit date.
 */
function migrateJobsToCustomers(db: IDBDatabase, transaction: IDBTransaction): void {
  if (!db.objectStoreNames.contains('jobs')) return;

  const jobs = transaction.objectStore('jobs');
  const customers = transaction.objectStore(STORES.customers);
  jobs.getAll().onsuccess = (event) => {
    const rows = (event.target as IDBRequest<Array<Record<string, unknown>>>).result ?? [];
    for (const row of rows) {
      const { name: _discardedJobName, notes, ...rest } = row;
      customers.put({ ...rest, workScope: notes ?? '', templateIds: [] });
    }
  };

  const inspections = transaction.objectStore(STORES.inspections);
  inspections.getAll().onsuccess = (event) => {
    const rows = (event.target as IDBRequest<Array<Record<string, unknown>>>).result ?? [];
    for (const row of rows) {
      if (row.customerId) continue;
      const { jobId, ...rest } = row;
      const createdAt = typeof row.createdAt === 'string' ? row.createdAt : '';
      inspections.put({
        ...rest,
        customerId: jobId,
        visitDate:
          (row.info as Record<string, string> | undefined)?.inspectionDate ??
          createdAt.slice(0, 10),
      });
    }
  };
}

function tx<T>(
  store: StoreName,
  mode: IDBTransactionMode,
  run: (s: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(store, mode);
        const request = run(transaction.objectStore(store));
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      }),
  );
}

async function getAllByIndex<T>(store: StoreName, index: string, value: string): Promise<T[]> {
  const db = await openDb();
  return new Promise<T[]>((resolve, reject) => {
    const transaction = db.transaction(store, 'readonly');
    const request = transaction.objectStore(store).index(index).getAll(value);
    request.onsuccess = () => resolve(request.result as T[]);
    request.onerror = () => reject(request.error);
  });
}

export const customersRepo = {
  all: () => tx<Customer[]>(STORES.customers, 'readonly', (s) => s.getAll()),
  get: (id: string) => tx<Customer | undefined>(STORES.customers, 'readonly', (s) => s.get(id)),
  put: (customer: Customer) => tx(STORES.customers, 'readwrite', (s) => s.put(customer)),
  remove: (id: string) => tx(STORES.customers, 'readwrite', (s) => s.delete(id)),
};

export const inspectionsRepo = {
  all: () => tx<Inspection[]>(STORES.inspections, 'readonly', (s) => s.getAll()),
  get: (id: string) => tx<Inspection | undefined>(STORES.inspections, 'readonly', (s) => s.get(id)),
  byCustomer: (customerId: string) =>
    getAllByIndex<Inspection>(STORES.inspections, 'customerId', customerId),
  put: (inspection: Inspection) => tx(STORES.inspections, 'readwrite', (s) => s.put(inspection)),
  remove: (id: string) => tx(STORES.inspections, 'readwrite', (s) => s.delete(id)),
};

export const photosRepo = {
  all: () => tx<PhotoRecord[]>(STORES.photos, 'readonly', (s) => s.getAll()),
  get: (id: string) => tx<PhotoRecord | undefined>(STORES.photos, 'readonly', (s) => s.get(id)),
  byInspection: (inspectionId: string) =>
    getAllByIndex<PhotoRecord>(STORES.photos, 'inspectionId', inspectionId),
  put: (photo: PhotoRecord) => tx(STORES.photos, 'readwrite', (s) => s.put(photo)),
  remove: (id: string) => tx(STORES.photos, 'readwrite', (s) => s.delete(id)),
};

export const templatesRepo = {
  all: () => tx<Template[]>(STORES.templates, 'readonly', (s) => s.getAll()),
  put: (template: Template) => tx(STORES.templates, 'readwrite', (s) => s.put(template)),
  remove: (id: string) => tx(STORES.templates, 'readwrite', (s) => s.delete(id)),
};

export const outboxRepo = {
  all: () => tx<OutboxEntry[]>(STORES.outbox, 'readonly', (s) => s.getAll()),
  put: (entry: OutboxEntry) => tx(STORES.outbox, 'readwrite', (s) => s.put(entry)),
  remove: (id: string) => tx(STORES.outbox, 'readwrite', (s) => s.delete(id)),
  clear: () => tx(STORES.outbox, 'readwrite', (s) => s.clear()),
};

const SETTINGS_KEY = 'app';
const SHARED_KEY = 'shared';
const SYNC_KEY = 'sync';

const DEFAULT_SETTINGS: Settings = { inspectorName: '', companyName: '', role: 'inspector' };

export const settingsRepo = {
  async get(): Promise<Settings> {
    const row = await tx<{ key: string; value: Settings } | undefined>(
      STORES.settings,
      'readonly',
      (s) => s.get(SETTINGS_KEY),
    );
    return { ...DEFAULT_SETTINGS, ...row?.value };
  },
  put: (value: Settings) =>
    tx(STORES.settings, 'readwrite', (s) => s.put({ key: SETTINGS_KEY, value })),
};

/** Shared config lives in the settings store since there is exactly one row. */
export const sharedRepo = {
  async get(): Promise<SharedConfig | undefined> {
    const row = await tx<{ key: string; value: SharedConfig } | undefined>(
      STORES.settings,
      'readonly',
      (s) => s.get(SHARED_KEY),
    );
    return row?.value;
  },
  put: (value: SharedConfig) =>
    tx(STORES.settings, 'readwrite', (s) => s.put({ key: SHARED_KEY, value })),
};

const DEFAULT_SYNC_STATE: SyncState = {
  pulledThrough: {},
  lastSyncedAt: null,
  seededRemote: false,
};

/**
 * The pull watermark. Kept per device rather than per account: two phones signed
 * in as the same person still have to catch up independently.
 */
export const syncRepo = {
  async get(): Promise<SyncState> {
    const row = await tx<{ key: string; value: SyncState } | undefined>(
      STORES.settings,
      'readonly',
      (s) => s.get(SYNC_KEY),
    );
    return { ...DEFAULT_SYNC_STATE, ...row?.value };
  },
  put: (value: SyncState) =>
    tx(STORES.settings, 'readwrite', (s) => s.put({ key: SYNC_KEY, value })),
  reset: () => tx(STORES.settings, 'readwrite', (s) => s.delete(SYNC_KEY)),
};

/** Remove an inspection together with every photo attached to it. */
export async function deleteInspectionCascade(inspectionId: string): Promise<void> {
  const photos = await photosRepo.byInspection(inspectionId);
  await Promise.all(photos.map((photo) => photosRepo.remove(photo.id)));
  await inspectionsRepo.remove(inspectionId);
}

/** Remove a customer together with every inspection and photo underneath it. */
export async function deleteCustomerCascade(customerId: string): Promise<void> {
  const inspections = await inspectionsRepo.byCustomer(customerId);
  await Promise.all(inspections.map((inspection) => deleteInspectionCascade(inspection.id)));
  await customersRepo.remove(customerId);
}
