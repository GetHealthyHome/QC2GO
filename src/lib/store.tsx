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
  deleteInspectionCascade,
  deleteJobCascade,
  inspectionsRepo,
  jobsRepo,
  photosRepo,
  settingsRepo,
  sharedRepo,
  templatesRepo,
} from './db';
import { compressImage } from './image';
import type {
  Inspection,
  Job,
  PhotoRecord,
  Settings,
  SharedConfig,
  Template,
  VisitType,
} from './types';
import { BUILT_IN_TEMPLATES, defaultSharedConfig } from '../templates';
import { resolveChecklist, snapshotOf } from './checklist';
import { todayIso } from './inspection';

function newId(prefix: string): string {
  const random =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now().toString(36)}${random}`;
}

interface StoreValue {
  ready: boolean;
  jobs: Job[];
  inspections: Inspection[];
  templates: Template[];
  shared: SharedConfig;
  settings: Settings;
  isAdmin: boolean;
  createJob: (input: Omit<Job, 'id' | 'createdAt' | 'updatedAt'>) => Promise<Job>;
  updateJob: (id: string, patch: Partial<Job>) => Promise<void>;
  removeJob: (id: string) => Promise<void>;
  createInspection: (jobId: string, templateId: string, visitType: VisitType) => Promise<Inspection>;
  updateInspection: (id: string, patch: Partial<Inspection>) => void;
  removeInspection: (id: string) => Promise<void>;
  addPhoto: (inspectionId: string, questionId: string, file: File) => Promise<string>;
  removePhoto: (id: string) => Promise<void>;
  getPhoto: (id: string) => Promise<PhotoRecord | undefined>;
  saveSettings: (next: Settings) => Promise<void>;
  saveTemplate: (template: Template) => Promise<void>;
  createTemplate: (input?: Partial<Template>) => Promise<Template>;
  duplicateTemplate: (id: string) => Promise<Template | undefined>;
  removeTemplate: (id: string) => Promise<void>;
  resetTemplate: (id: string) => Promise<void>;
  saveShared: (next: SharedConfig) => Promise<void>;
  resetShared: () => Promise<void>;
}

const StoreContext = createContext<StoreValue | null>(null);

const WRITE_DEBOUNCE_MS = 400;

export function StoreProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [inspections, setInspections] = useState<Inspection[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [shared, setShared] = useState<SharedConfig>(() => defaultSharedConfig());
  const [settings, setSettings] = useState<Settings>({
    inspectorName: '',
    companyName: '',
    role: 'inspector',
  });

  /** Pending debounced writes keyed by inspection id, flushed on unload. */
  const pendingWrites = useRef(new Map<string, { timer: number; record: Inspection }>());

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      jobsRepo.all(),
      inspectionsRepo.all(),
      settingsRepo.get(),
      templatesRepo.all(),
      sharedRepo.get(),
    ])
      .then(async ([loadedJobs, loadedInspections, loadedSettings, loadedTemplates, loadedShared]) => {
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
        setJobs(loadedJobs);
        setInspections(loadedInspections);
        setSettings(loadedSettings);
        setTemplates(seededTemplates);
        setShared(seededShared);
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

  const flushPending = useCallback(() => {
    for (const [, entry] of pendingWrites.current) {
      clearTimeout(entry.timer);
      void inspectionsRepo.put(entry.record);
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
    }, WRITE_DEBOUNCE_MS);
    pendingWrites.current.set(record.id, { timer, record });
  }, []);

  const createJob = useCallback<StoreValue['createJob']>(async (input) => {
    const now = new Date().toISOString();
    const job: Job = { ...input, id: newId('job'), createdAt: now, updatedAt: now };
    await jobsRepo.put(job);
    setJobs((current) => [...current, job]);
    return job;
  }, []);

  const updateJob = useCallback<StoreValue['updateJob']>(async (id, patch) => {
    let next: Job | undefined;
    setJobs((current) =>
      current.map((job) => {
        if (job.id !== id) return job;
        next = { ...job, ...patch, updatedAt: new Date().toISOString() };
        return next;
      }),
    );
    const stored = await jobsRepo.get(id);
    if (stored) await jobsRepo.put({ ...stored, ...patch, updatedAt: new Date().toISOString() });
  }, []);

  const removeJob = useCallback<StoreValue['removeJob']>(async (id) => {
    await deleteJobCascade(id);
    setJobs((current) => current.filter((job) => job.id !== id));
    setInspections((current) => current.filter((inspection) => inspection.jobId !== id));
  }, []);

  const createInspection = useCallback<StoreValue['createInspection']>(
    async (jobId, templateId, visitType) => {
      const job = jobs.find((candidate) => candidate.id === jobId);
      const template = templates.find((candidate) => candidate.id === templateId);
      if (!template) throw new Error(`Unknown checklist: ${templateId}`);
      const info: Record<string, string> = {};
      for (const field of shared.infoFields) {
        if (field.fromJob && job) {
          const value = job[field.fromJob];
          if (typeof value === 'string') info[field.id] = value;
        }
      }
      info.inspectionDate = todayIso();
      if (settings.inspectorName) info.inspector = settings.inspectorName;
      info.customerPresent = visitType === 'final-walkthrough' ? 'Yes' : 'No';

      const now = new Date().toISOString();
      const inspection: Inspection = {
        id: newId('insp'),
        jobId,
        templateId: template.id,
        // Freeze the checklist as it stands today; later admin edits must not
        // rewrite an inspection that is already under way or signed.
        snapshot: snapshotOf(template, shared),
        visitType,
        status: 'in-progress',
        info,
        responses: {},
        createdAt: now,
        updatedAt: now,
      };
      await inspectionsRepo.put(inspection);
      setInspections((current) => [...current, inspection]);
      return inspection;
    },
    [jobs, templates, shared, settings.inspectorName],
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
    await deleteInspectionCascade(id);
    setInspections((current) => current.filter((inspection) => inspection.id !== id));
  }, []);

  const addPhoto = useCallback<StoreValue['addPhoto']>(
    async (inspectionId, questionId, file) => {
      const blob = await compressImage(file);
      const photo: PhotoRecord = {
        id: newId('img'),
        inspectionId,
        questionId,
        blob,
        createdAt: new Date().toISOString(),
      };
      await photosRepo.put(photo);
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

  const getPhoto = useCallback<StoreValue['getPhoto']>((id) => photosRepo.get(id), []);

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
    setTemplates((current) => current.filter((template) => template.id !== id));
  }, []);

  /** Restore a shipped checklist to the version that came with the app. */
  const resetTemplate = useCallback<StoreValue['resetTemplate']>(async (id) => {
    const original = BUILT_IN_TEMPLATES.find((template) => template.id === id);
    if (!original) return;
    const now = new Date().toISOString();
    const restored: Template = { ...structuredClone(original), createdAt: now, updatedAt: now };
    await templatesRepo.put(restored);
    setTemplates((current) =>
      current.map((template) => (template.id === id ? restored : template)),
    );
  }, []);

  const saveShared = useCallback<StoreValue['saveShared']>(async (next) => {
    const stamped: SharedConfig = { ...next, updatedAt: new Date().toISOString() };
    await sharedRepo.put(stamped);
    setShared(stamped);
  }, []);

  const resetShared = useCallback<StoreValue['resetShared']>(async () => {
    const restored = defaultSharedConfig();
    await sharedRepo.put(restored);
    setShared(restored);
  }, []);

  const value = useMemo<StoreValue>(
    () => ({
      ready,
      jobs,
      inspections,
      templates,
      shared,
      settings,
      isAdmin: settings.role === 'admin',
      createJob,
      updateJob,
      removeJob,
      createInspection,
      updateInspection,
      removeInspection,
      addPhoto,
      removePhoto,
      getPhoto,
      saveSettings,
      saveTemplate,
      createTemplate,
      duplicateTemplate,
      removeTemplate,
      resetTemplate,
      saveShared,
      resetShared,
    }),
    [
      ready,
      jobs,
      inspections,
      templates,
      shared,
      settings,
      createJob,
      updateJob,
      removeJob,
      createInspection,
      updateInspection,
      removeInspection,
      addPhoto,
      removePhoto,
      getPhoto,
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

export function useJob(jobId: string | undefined): Job | undefined {
  const { jobs } = useStore();
  return useMemo(() => jobs.find((job) => job.id === jobId), [jobs, jobId]);
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

export function useJobInspections(jobId: string | undefined): Inspection[] {
  const { inspections } = useStore();
  return useMemo(
    () =>
      inspections
        .filter((inspection) => inspection.jobId === jobId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [inspections, jobId],
  );
}
