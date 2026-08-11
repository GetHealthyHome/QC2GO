import type {
  FieldDef,
  Inspection,
  Question,
  Section,
  SharedConfig,
  Template,
  TemplateSnapshot,
} from './types';

/** The questions an inspection actually runs: universal block first, then the system work. */
export function composeSections(template: Template, shared: SharedConfig): Section[] {
  return [shared.universalSection, ...template.sections];
}

export function snapshotOf(template: Template, shared: SharedConfig): TemplateSnapshot {
  return {
    templateId: template.id,
    templateName: template.name,
    templateVersion: template.version ?? 1,
    infoFields: shared.infoFields,
    sections: composeSections(template, shared),
    capturedAt: new Date().toISOString(),
  };
}

export interface ResolvedChecklist {
  templateName: string;
  sections: Section[];
  infoFields: FieldDef[];
  /** True when the inspection predates snapshots and had to fall back to the live template. */
  fromLiveTemplate: boolean;
}

/**
 * An inspection reads from the snapshot it captured at creation, so editing a
 * checklist never rewrites history. Only pre-snapshot records fall back to the
 * live template, and those are matched by id.
 */
export function resolveChecklist(
  inspection: Inspection,
  templates: Template[],
  shared: SharedConfig,
): ResolvedChecklist | undefined {
  if (inspection.snapshot) {
    return {
      templateName: inspection.snapshot.templateName,
      sections: inspection.snapshot.sections,
      infoFields: inspection.snapshot.infoFields,
      fromLiveTemplate: false,
    };
  }
  const template = templates.find((candidate) => candidate.id === inspection.templateId);
  if (!template) return undefined;
  return {
    templateName: template.name,
    sections: composeSections(template, shared),
    infoFields: shared.infoFields,
    fromLiveTemplate: true,
  };
}

export function questionCount(template: Template, shared: SharedConfig): number {
  return composeSections(template, shared).reduce(
    (total, section) => total + section.questions.length,
    0,
  );
}

/** Ids only need to be unique inside one checklist, and stable once answered against. */
export function newElementId(prefix: string): string {
  const random =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `${prefix}-${random}`;
}

export function moveItem<T>(items: T[], from: number, to: number): T[] {
  if (to < 0 || to >= items.length || from === to) return items;
  const next = [...items];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

export function blankQuestion(): Question {
  return { id: newElementId('q'), text: '', kind: 'yesno' };
}

export function blankSection(): Section {
  return { id: newElementId('s'), title: 'New section', questions: [blankQuestion()] };
}
