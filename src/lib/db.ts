import type { Inspection, Job, PhotoRecord, Settings } from './types';

/**
 * Everything lives in IndexedDB so an inspection survives a dead cell signal in a
 * crawlspace, a backgrounded tab, or a phone that reboots mid-walkthrough.
 */
const DB_NAME = 'qc2go';
const DB_VERSION = 1;

export const STORES = {
  jobs: 'jobs',
  inspections: 'inspections',
  photos: 'photos',
  settings: 'settings',
} as const;

type StoreName = (typeof STORES)[keyof typeof STORES];

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORES.jobs)) {
        db.createObjectStore(STORES.jobs, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORES.inspections)) {
        const store = db.createObjectStore(STORES.inspections, { keyPath: 'id' });
        store.createIndex('jobId', 'jobId', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORES.photos)) {
        const store = db.createObjectStore(STORES.photos, { keyPath: 'id' });
        store.createIndex('inspectionId', 'inspectionId', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORES.settings)) {
        db.createObjectStore(STORES.settings, { keyPath: 'key' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return dbPromise;
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

export const jobsRepo = {
  all: () => tx<Job[]>(STORES.jobs, 'readonly', (s) => s.getAll()),
  get: (id: string) => tx<Job | undefined>(STORES.jobs, 'readonly', (s) => s.get(id)),
  put: (job: Job) => tx(STORES.jobs, 'readwrite', (s) => s.put(job)),
  remove: (id: string) => tx(STORES.jobs, 'readwrite', (s) => s.delete(id)),
};

export const inspectionsRepo = {
  all: () => tx<Inspection[]>(STORES.inspections, 'readonly', (s) => s.getAll()),
  get: (id: string) => tx<Inspection | undefined>(STORES.inspections, 'readonly', (s) => s.get(id)),
  byJob: (jobId: string) => getAllByIndex<Inspection>(STORES.inspections, 'jobId', jobId),
  put: (inspection: Inspection) => tx(STORES.inspections, 'readwrite', (s) => s.put(inspection)),
  remove: (id: string) => tx(STORES.inspections, 'readwrite', (s) => s.delete(id)),
};

export const photosRepo = {
  get: (id: string) => tx<PhotoRecord | undefined>(STORES.photos, 'readonly', (s) => s.get(id)),
  byInspection: (inspectionId: string) =>
    getAllByIndex<PhotoRecord>(STORES.photos, 'inspectionId', inspectionId),
  put: (photo: PhotoRecord) => tx(STORES.photos, 'readwrite', (s) => s.put(photo)),
  remove: (id: string) => tx(STORES.photos, 'readwrite', (s) => s.delete(id)),
};

const SETTINGS_KEY = 'app';

export const settingsRepo = {
  async get(): Promise<Settings> {
    const row = await tx<{ key: string; value: Settings } | undefined>(
      STORES.settings,
      'readonly',
      (s) => s.get(SETTINGS_KEY),
    );
    return row?.value ?? { inspectorName: '', companyName: '' };
  },
  put: (value: Settings) =>
    tx(STORES.settings, 'readwrite', (s) => s.put({ key: SETTINGS_KEY, value })),
};

/** Remove an inspection together with every photo attached to it. */
export async function deleteInspectionCascade(inspectionId: string): Promise<void> {
  const photos = await photosRepo.byInspection(inspectionId);
  await Promise.all(photos.map((photo) => photosRepo.remove(photo.id)));
  await inspectionsRepo.remove(inspectionId);
}

/** Remove a job together with every inspection and photo underneath it. */
export async function deleteJobCascade(jobId: string): Promise<void> {
  const inspections = await inspectionsRepo.byJob(jobId);
  await Promise.all(inspections.map((inspection) => deleteInspectionCascade(inspection.id)));
  await jobsRepo.remove(jobId);
}
