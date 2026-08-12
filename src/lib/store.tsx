import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  customersRepo,
  deleteCustomerCascade,
  deleteInspectionCascade,
  inspectionsRepo,
  photosRepo,
  settingsRepo,
  sharedRepo,
  tasksRepo,
  templatesRepo,
} from './db';
import {
  configureSync,
  enqueue,
  fetchPhotoBlob,
  startSyncTriggers,
  useSyncStatus,
  type SyncStatus,
} from './sync';
import { prepareEvidencePhoto } from './image';
import type {
  Annotation,
  Customer,
  Inspection,
  PhotoRecord,
  Settings,
  SharedConfig,
  Task,
  TaskState,
  Template,
  VisitType,
} from './types';
import { hasAdminRights } from './types';
import { applyMove, canMove, resolutionFor, type MoveDecision } from './tasks';
import { BUILT_IN_TEMPLATES, defaultSharedConfig } from '../templates';
import { resolveChecklist, snapshotOf } from './checklist';
import { todayIso } from './inspection';
import { useAuth } from './auth';

/**
 * Record ids, generated on the device because a record has to exist before
 * there is any network to ask about it.
 *
 * The random half used to be the first 8 characters of a UUID, which is fine
 * for one company and not for many: 8 hex characters collide at around a 1-in-2
 * chance by 100k records, and a collision here is a primary key violation on
 * upload — which the sync engine treats as permanent and stops retrying. The
 * whole UUID costs 28 more characters and removes the question.
 */
function newId(prefix: string): string {
  const random =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
  return `${prefix}_${Date.now().toString(36)}${random}`;
}

/**
 * Deleting a row on the server cascades to the rows beneath it, but nothing
 * cascades into the storage bucket. These queue the file removals while the
 * records that know their bucket keys still exist.
 */
async function queuePhotoDeletes(photos: PhotoRecord[]): Promise<void> {
  for (const photo of photos) {
    // No `storagePath` means the bytes never reached the bucket, so there is no
    // file to chase. It used to fall back to a computed path here, which asked
    // the server to delete an object that had never existed.
    await enqueue('photo', photo.id, 'delete', photo.storagePath);
  }
}

async function queuePhotoDeletesForCustomer(customerId: string): Promise<void> {
  const inspections = await inspectionsRepo.byCustomer(customerId);
  for (const inspection of inspections) {
    await queuePhotoDeletes(await photosRepo.byInspection(inspection.id));
  }
}

interface StoreValue {
  ready: boolean;
  customers: Customer[];
  inspections: Inspection[];
  templates: Template[];
  tasks: Task[];
  shared: SharedConfig;
  settings: Settings;
  isAdmin: boolean;
  createCustomer: (
    input: Omit<Customer, 'id' | 'createdAt' | 'updatedAt'>,
  ) => Promise<Customer>;
  updateCustomer: (id: string, patch: Partial<Customer>) => Promise<void>;
  removeCustomer: (id: string) => Promise<void>;
  createInspection: (
    customerId: string,
    templateId: string,
    visitType: VisitType,
    visitDate?: string,
  ) => Promise<Inspection>;
  updateInspection: (id: string, patch: Partial<Inspection>) => void;
  removeInspection: (id: string) => Promise<void>;
  addPhoto: (inspectionId: string, questionId: string, file: File) => Promise<string>;
  removePhoto: (id: string) => Promise<void>;
  getPhoto: (id: string) => Promise<PhotoRecord | undefined>;
  /**
   * Every photo record on one inspection, for reading what is attached to them
   * rather than for drawing them — where they were taken, when the shutter
   * fired. Deliberately not a hook over the whole history: these records carry
   * the image bytes, and pulling a month of them into memory to read a pair of
   * coordinates is a bad trade.
   */
  getInspectionPhotos: (inspectionId: string) => Promise<PhotoRecord[]>;
  /** Replace the marks drawn on a photo. The image bytes are never touched. */
  savePhotoAnnotations: (id: string, annotations: Annotation[]) => Promise<void>;
  saveSettings: (next: Settings) => Promise<void>;
  saveTemplate: (template: Template) => Promise<void>;
  createTemplate: (input?: Partial<Template>) => Promise<Template>;
  duplicateTemplate: (id: string) => Promise<Template | undefined>;
  removeTemplate: (id: string) => Promise<void>;
  resetTemplate: (id: string) => Promise<void>;
  createTask: (input: Omit<Task, 'id' | 'history' | 'createdAt' | 'updatedAt'>) => Promise<Task>;
  updateTask: (id: string, patch: Partial<Task>) => Promise<void>;
  /**
   * Move a task through the lifecycle. Refuses an illegal move rather than
   * writing it, and returns why so the screen can say so.
   *
   * Verifying a task that corrects a punch item does not set its state — it
   * records the deficiency as corrected on the customer, which is where the
   * punch list already looks and where `effectiveState` reads it back. One
   * record of whether a deficiency was fixed, not two that can disagree.
   */
  moveTask: (id: string, to: TaskState, note?: string) => Promise<MoveDecision>;
  removeTask: (id: string) => Promise<void>;
  saveShared: (next: SharedConfig) => Promise<void>;
  resetShared: () => Promise<void>;
  /** What the sync engine is doing, for the status line on Settings. */
  sync: SyncStatus;
}

const StoreContext = createContext<StoreValue | null>(null);

const WRITE_DEBOUNCE_MS = 400;

export function StoreProvider({ children }: { children: ReactNode }) {
  // AuthProvider wraps this, so the signed-in profile is available here.
  const auth = useAuth();
  const sync = useSyncStatus();
  const [ready, setReady] = useState(false);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [inspections, setInspections] = useState<Inspection[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [shared, setShared] = useState<SharedConfig>(() => defaultSharedConfig());
  const [settings, setSettings] = useState<Settings>({
    inspectorName: '',
    companyName: '',
    role: 'inspector',
  });

  const [tasks, setTasks] = useState<Task[]>([]);

  /** Pending debounced writes keyed by inspection id, flushed on unload. */
  const pendingWrites = useRef(new Map<string, { timer: number; record: Inspection }>());

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      customersRepo.all(),
      inspectionsRepo.all(),
      settingsRepo.get(),
      templatesRepo.all(),
      sharedRepo.get(),
      tasksRepo.all(),
    ])
      .then(async ([
        loadedCustomers,
        loadedInspections,
        loadedSettings,
        loadedTemplates,
        loadedShared,
        loadedTasks,
      ]) => {
        // First run: seed the editable stores from the shipped checklists.
        let seededTemplates = loadedTemplates;
        if (seededTemplates.length === 0) {
          const now = new Date().toISOString();
          seededTemplates = BUILT_IN_TEMPLATES.map((template) => ({
            ...template,
            createdAt: now,
            updatedAt: now,
          }));
          await Promise.all(seededTemplates.map((template) => templatesRepo.put(template)));
        }
        let seededShared = loadedShared;
        if (!seededShared) {
          seededShared = defaultSharedConfig();
          await sharedRepo.put(seededShared);
        }
        if (cancelled) return;
        setCustomers(loadedCustomers);
        setInspections(loadedInspections);
        setSettings(loadedSettings);
        setTemplates(seededTemplates);
        setShared(seededShared);
        setTasks(loadedTasks);
        setReady(true);
      })
      .catch((error) => {
        console.error('QC2GO failed to open local storage', error);
        if (!cancelled) setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Sync runs under the signed-in account, and stops entirely when there is not
  // one. The role decides whether checklist edits are even offered to the
  // server — row-level security would refuse them from an inspector anyway —
  // and the organization is stamped on everything this device uploads.
  useEffect(() => {
    void configureSync(
      auth.session?.user && auth.profile
        ? {
            userId: auth.session.user.id,
            isAdmin: hasAdminRights(auth.profile.role),
            orgId: auth.profile.organization?.id ?? null,
          }
        : null,
    );
  }, [auth.session?.user?.id, auth.profile?.role, auth.profile?.organization?.id]);

  useEffect(() => startSyncTriggers(), []);

  /**
   * A pull writes straight to IndexedDB, so React has to be told. Reading it
   * back rather than threading changes through the engine keeps one source of
   * truth: whatever is on disk is what the screens show.
   */
  useEffect(() => {
    if (sync.revision === 0) return;
    let cancelled = false;
    void Promise.all([
      customersRepo.all(),
      inspectionsRepo.all(),
      templatesRepo.all(),
      sharedRepo.get(),
      tasksRepo.all(),
    ]).then(([nextCustomers, nextInspections, nextTemplates, nextShared, nextTasks]) => {
      if (cancelled) return;
      setCustomers(nextCustomers);
      setInspections(nextInspections);
      setTemplates(nextTemplates);
      setTasks(nextTasks);
      if (nextShared) setShared(nextShared);
    });
    return () => {
      cancelled = true;
    };
  }, [sync.revision]);

  const flushPending = useCallback(() => {
    for (const [, entry] of pendingWrites.current) {
      clearTimeout(entry.timer);
      void inspectionsRepo.put(entry.record);
      void enqueue('inspection', entry.record.id, 'upsert');
    }
    pendingWrites.current.clear();
  }, []);

  useEffect(() => {
    const handler = () => flushPending();
    window.addEventListener('pagehide', handler);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flushPending();
    });
    return () => {
      window.removeEventListener('pagehide', handler);
      flushPending();
    };
  }, [flushPending]);

  const queueInspectionWrite = useCallback((record: Inspection) => {
    const existing = pendingWrites.current.get(record.id);
    if (existing) clearTimeout(existing.timer);
    const timer = window.setTimeout(() => {
      pendingWrites.current.delete(record.id);
      void inspectionsRepo.put(record);
      // Queued from inside the debounce rather than on every keystroke, so a
      // long answer is one upload instead of forty.
      void enqueue('inspection', record.id, 'upsert');
    }, WRITE_DEBOUNCE_MS);
    pendingWrites.current.set(record.id, { timer, record });
  }, []);

  const createCustomer = useCallback<StoreValue['createCustomer']>(async (input) => {
    const now = new Date().toISOString();
    const customer: Customer = { ...input, id: newId('cust'), createdAt: now, updatedAt: now };
    await customersRepo.put(customer);
    setCustomers((current) => [...current, customer]);
    await enqueue('customer', customer.id, 'upsert');
    return customer;
  }, []);

  const updateCustomer = useCallback<StoreValue['updateCustomer']>(async (id, patch) => {
    setCustomers((current) =>
      current.map((customer) =>
        customer.id === id
          ? { ...customer, ...patch, updatedAt: new Date().toISOString() }
          : customer,
      ),
    );
    const stored = await customersRepo.get(id);
    if (stored) {
      await customersRepo.put({ ...stored, ...patch, updatedAt: new Date().toISOString() });
      await enqueue('customer', id, 'upsert');
    }
  }, []);

  const removeCustomer = useCallback<StoreValue['removeCustomer']>(async (id) => {
    // The server cascades the rows, but not the photo files behind them, so the
    // bucket keys are collected here while the records still know them.
    await queuePhotoDeletesForCustomer(id);
    await deleteCustomerCascade(id);
    await enqueue('customer', id, 'delete');
    setCustomers((current) => current.filter((customer) => customer.id !== id));
    setInspections((current) => current.filter((inspection) => inspection.customerId !== id));
  }, []);

  const createTask = useCallback<StoreValue['createTask']>(
    async (input) => {
      const now = new Date().toISOString();
      const by = auth.profile?.email;
      const task: Task = {
        ...input,
        id: newId('task'),
        history: [{ at: now, to: input.state, ...(by ? { by } : {}) }],
        createdBy: by,
        createdAt: now,
        updatedAt: now,
      };
      await tasksRepo.put(task);
      setTasks((current) => [...current, task]);
      await enqueue('task', task.id, 'upsert');
      return task;
    },
    [auth.profile?.email],
  );

  const updateTask = useCallback<StoreValue['updateTask']>(async (id, patch) => {
    const stored = await tasksRepo.get(id);
    if (!stored) return;
    const next: Task = { ...stored, ...patch, updatedAt: new Date().toISOString() };
    await tasksRepo.put(next);
    setTasks((current) => current.map((task) => (task.id === id ? next : task)));
    await enqueue('task', id, 'upsert');
  }, []);

  const moveTask = useCallback<StoreValue['moveTask']>(
    async (id, to, note) => {
      const stored = await tasksRepo.get(id);
      if (!stored) return { ok: false, reason: 'That task is no longer on this device.' };

      const by = auth.profile?.email;
      const policy = { requireSecondVerifier: shared.requireSecondVerifier, actor: by };

      const decision = canMove(stored, to, { note, ...policy });
      if (!decision.ok) return decision;

      const now = new Date().toISOString();

      // Verifying a linked task writes the deficiency's correction, not a
      // second record of it. `effectiveState` reads it back, so the punch
      // screen and the board cannot end up saying different things.
      if (to === 'verified' && stored.punchKey) {
        const customer = await customersRepo.get(stored.customerId);
        if (customer) {
          const punchResolutions = {
            ...(customer.punchResolutions ?? {}),
            [stored.punchKey]: resolutionFor({ by, note, now }),
          };
          await updateCustomer(customer.id, { punchResolutions });
        }
      }

      const next = applyMove(stored, to, {
        by,
        note,
        now,
        requireSecondVerifier: shared.requireSecondVerifier,
      });
      await tasksRepo.put(next);
      setTasks((current) => current.map((task) => (task.id === id ? next : task)));
      await enqueue('task', id, 'upsert');
      return { ok: true };
    },
    [auth.profile?.email, shared.requireSecondVerifier, updateCustomer],
  );

  const removeTask = useCallback<StoreValue['removeTask']>(async (id) => {
    await tasksRepo.remove(id);
    setTasks((current) => current.filter((task) => task.id !== id));
    await enqueue('task', id, 'delete');
  }, []);

  const createInspection = useCallback<StoreValue['createInspection']>(
    async (customerId, templateId, visitType, visitDate) => {
      const customer = customers.find((candidate) => candidate.id === customerId);
      const template = templates.find((candidate) => candidate.id === templateId);
      if (!template) throw new Error(`Unknown checklist: ${templateId}`);
      const info: Record<string, string> = {};
      for (const field of shared.infoFields) {
        if (field.fromJob && customer) {
          const value = customer[field.fromJob];
          if (typeof value === 'string') info[field.id] = value;
        }
      }
      const day = visitDate ?? todayIso();
      info.inspectionDate = day;
      if (settings.inspectorName) info.inspector = settings.inspectorName;
      info.customerPresent = visitType === 'final-walkthrough' ? 'Yes' : 'No';

      const now = new Date().toISOString();
      const inspection: Inspection = {
        id: newId('insp'),
        customerId,
        templateId: template.id,
        // Freeze the checklist as it stands today; later admin edits must not
        // rewrite an inspection that is already under way or signed.
        snapshot: snapshotOf(template, shared),
        visitType,
        visitDate: day,
        status: 'in-progress',
        info,
        responses: {},
        createdAt: now,
        updatedAt: now,
      };
      await inspectionsRepo.put(inspection);
      setInspections((current) => [...current, inspection]);
      await enqueue('inspection', inspection.id, 'upsert');
      return inspection;
    },
    [customers, templates, shared, settings.inspectorName],
  );

  const updateInspection = useCallback<StoreValue['updateInspection']>(
    (id, patch) => {
      setInspections((current) =>
        current.map((inspection) => {
          if (inspection.id !== id) return inspection;
          const next = { ...inspection, ...patch, updatedAt: new Date().toISOString() };
          queueInspectionWrite(next);
          return next;
        }),
      );
    },
    [queueInspectionWrite],
  );

  const removeInspection = useCallback<StoreValue['removeInspection']>(async (id) => {
    await queuePhotoDeletes(await photosRepo.byInspection(id));
    await deleteInspectionCascade(id);
    await enqueue('inspection', id, 'delete');
    setInspections((current) => current.filter((inspection) => inspection.id !== id));
  }, []);

  const addPhoto = useCallback<StoreValue['addPhoto']>(
    async (inspectionId, questionId, file) => {
      const prepared = await prepareEvidencePhoto(file, {
        inspectionId,
        inspectorName: auth.profile?.fullName || auth.profile?.email || settings.inspectorName,
      });
      const photo: PhotoRecord = {
        id: newId('img'),
        inspectionId,
        questionId,
        blob: prepared.blob,
        takenAt: prepared.takenAt,
        gps: prepared.gps,
        gpsSource: prepared.gpsSource,
        watermarked: prepared.watermarked,
        createdAt: new Date().toISOString(),
      };
      await photosRepo.put(photo);
      await enqueue('photo', photo.id, 'upsert');
      setInspections((current) =>
        current.map((inspection) => {
          if (inspection.id !== inspectionId) return inspection;
          const response = inspection.responses[questionId] ?? { answer: null, photoIds: [] };
          const next: Inspection = {
            ...inspection,
            responses: {
              ...inspection.responses,
              [questionId]: { ...response, photoIds: [...response.photoIds, photo.id] },
            },
            updatedAt: new Date().toISOString(),
          };
          queueInspectionWrite(next);
          return next;
        }),
      );
      return photo.id;
    },
    [queueInspectionWrite],
  );

  const removePhoto = useCallback<StoreValue['removePhoto']>(
    async (id) => {
      const photo = await photosRepo.get(id);
      await photosRepo.remove(id);
      if (!photo) return;
      await enqueue('photo', id, 'delete', photo.storagePath);
      setInspections((current) =>
        current.map((inspection) => {
          if (inspection.id !== photo.inspectionId) return inspection;
          const response = inspection.responses[photo.questionId];
          if (!response) return inspection;
          const next: Inspection = {
            ...inspection,
            responses: {
              ...inspection.responses,
              [photo.questionId]: {
                ...response,
                photoIds: response.photoIds.filter((photoId) => photoId !== id),
              },
            },
            updatedAt: new Date().toISOString(),
          };
          queueInspectionWrite(next);
          return next;
        }),
      );
    },
    [queueInspectionWrite],
  );

  /**
   * A photo pulled from another device arrives as a record with no bytes. This
   * is the one place anything renders an image, so it is where the download
   * happens — and it is cached locally afterwards, so it only happens once.
   */
  const getPhoto = useCallback<StoreValue['getPhoto']>(async (id) => {
    const photo = await photosRepo.get(id);
    if (!photo || photo.blob) return photo;
    return fetchPhotoBlob(photo);
  }, []);

  const getInspectionPhotos = useCallback<StoreValue['getInspectionPhotos']>(
    (inspectionId) => photosRepo.byInspection(inspectionId),
    [],
  );

  const savePhotoAnnotations = useCallback<StoreValue['savePhotoAnnotations']>(
    async (id, annotations) => {
      const photo = await photosRepo.get(id);
      if (!photo) return;
      // Absent rather than an empty array when every mark has been removed, so
      // a photo that was never annotated and one that has been cleared look the
      // same everywhere downstream.
      await photosRepo.put({ ...photo, annotations: annotations.length ? annotations : undefined });
      await enqueue('photo', id, 'upsert');
      // Photos are read through `getPhoto` rather than held in React state, so
      // nudging the inspection is what tells the screens to look again.
      setInspections((current) => [...current]);
    },
    [],
  );

  const saveSettings = useCallback<StoreValue['saveSettings']>(async (next) => {
    setSettings(next);
    await settingsRepo.put(next);
  }, []);

  const saveTemplate = useCallback<StoreValue['saveTemplate']>(async (template) => {
    const next: Template = {
      ...template,
      version: (template.version ?? 1) + 1,
      updatedAt: new Date().toISOString(),
    };
    await templatesRepo.put(next);
    await enqueue('template', next.id, 'upsert');
    setTemplates((current) => {
      const exists = current.some((candidate) => candidate.id === next.id);
      return exists
        ? current.map((candidate) => (candidate.id === next.id ? next : candidate))
        : [...current, next];
    });
  }, []);

  const createTemplate = useCallback<StoreValue['createTemplate']>(async (input) => {
    const now = new Date().toISOString();
    const template: Template = {
      id: newId('tpl'),
      name: 'Untitled checklist',
      category: 'custom',
      summary: '',
      sections: [],
      builtIn: false,
      version: 1,
      createdAt: now,
      updatedAt: now,
      ...input,
    };
    await templatesRepo.put(template);
    await enqueue('template', template.id, 'upsert');
    setTemplates((current) => [...current, template]);
    return template;
  }, []);

  const duplicateTemplate = useCallback<StoreValue['duplicateTemplate']>(
    async (id) => {
      const source = templates.find((candidate) => candidate.id === id);
      if (!source) return undefined;
      return createTemplate({
        name: `${source.name} (copy)`,
        category: source.category,
        summary: source.summary,
        sections: structuredClone(source.sections),
      });
    },
    [templates, createTemplate],
  );

  const removeTemplate = useCallback<StoreValue['removeTemplate']>(async (id) => {
    await templatesRepo.remove(id);
    await enqueue('template', id, 'delete');
    setTemplates((current) => current.filter((template) => template.id !== id));
  }, []);

  /** Restore a shipped checklist to the version that came with the app. */
  const resetTemplate = useCallback<StoreValue['resetTemplate']>(async (id) => {
    const original = BUILT_IN_TEMPLATES.find((template) => template.id === id);
    if (!original) return;
    const now = new Date().toISOString();
    const restored: Template = { ...structuredClone(original), createdAt: now, updatedAt: now };
    await templatesRepo.put(restored);
    await enqueue('template', id, 'upsert');
    setTemplates((current) =>
      current.map((template) => (template.id === id ? restored : template)),
    );
  }, []);

  const saveShared = useCallback<StoreValue['saveShared']>(async (next) => {
    const stamped: SharedConfig = { ...next, updatedAt: new Date().toISOString() };
    await sharedRepo.put(stamped);
    await enqueue('shared', 'shared', 'upsert');
    setShared(stamped);
  }, []);

  const resetShared = useCallback<StoreValue['resetShared']>(async () => {
    const restored = defaultSharedConfig();
    await sharedRepo.put(restored);
    await enqueue('shared', 'shared', 'upsert');
    setShared(restored);
  }, []);

  const value = useMemo<StoreValue>(
    () => ({
      ready,
      customers,
      inspections,
      templates,
      tasks,
      shared,
      settings,
      // With accounts connected the role is the server's answer, not a local
      // toggle anyone could flip.
      isAdmin: hasAdminRights(auth.profile ? auth.profile.role : settings.role),
      createCustomer,
      updateCustomer,
      removeCustomer,
      createInspection,
      updateInspection,
      removeInspection,
      addPhoto,
      removePhoto,
      getPhoto,
      getInspectionPhotos,
      savePhotoAnnotations,
      saveSettings,
      saveTemplate,
      createTemplate,
      duplicateTemplate,
      removeTemplate,
      resetTemplate,
      createTask,
      updateTask,
      moveTask,
      removeTask,
      saveShared,
      resetShared,
      sync,
    }),
    [
      ready,
      sync,
      customers,
      inspections,
      templates,
      tasks,
      shared,
      settings,
      auth.profile,
      createTask,
      updateTask,
      moveTask,
      removeTask,
      createCustomer,
      updateCustomer,
      removeCustomer,
      createInspection,
      updateInspection,
      removeInspection,
      addPhoto,
      removePhoto,
      getPhoto,
      getInspectionPhotos,
      savePhotoAnnotations,
      saveSettings,
      saveTemplate,
      createTemplate,
      duplicateTemplate,
      removeTemplate,
      resetTemplate,
      saveShared,
      resetShared,
    ],
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreValue {
  const value = useContext(StoreContext);
  if (!value) throw new Error('useStore must be used inside StoreProvider');
  return value;
}

export function useCustomer(customerId: string | undefined): Customer | undefined {
  const { customers } = useStore();
  return useMemo(
    () => customers.find((customer) => customer.id === customerId),
    [customers, customerId],
  );
}

export function useInspection(inspectionId: string | undefined): Inspection | undefined {
  const { inspections } = useStore();
  return useMemo(
    () => inspections.find((inspection) => inspection.id === inspectionId),
    [inspections, inspectionId],
  );
}

/** The sections and info fields an inspection should render, snapshot-aware. */
export function useChecklist(inspection: Inspection | undefined) {
  const { templates, shared } = useStore();
  return useMemo(
    () => (inspection ? resolveChecklist(inspection, templates, shared) : undefined),
    [inspection, templates, shared],
  );
}

export function useTemplate(templateId: string | undefined): Template | undefined {
  const { templates } = useStore();
  return useMemo(
    () => templates.find((template) => template.id === templateId),
    [templates, templateId],
  );
}

export function useCustomerInspections(customerId: string | undefined): Inspection[] {
  const { inspections } = useStore();
  return useMemo(
    () =>
      inspections
        .filter((inspection) => inspection.customerId === customerId)
        .sort(
          (a, b) =>
            b.visitDate.localeCompare(a.visitDate) || b.createdAt.localeCompare(a.createdAt),
        ),
    [inspections, customerId],
  );
}
