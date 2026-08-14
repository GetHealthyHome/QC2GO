/**
 * What goes in the report PDF, in order, before anything knows how tall it is.
 *
 * Deliberately the same reading of the record the on-screen report performs —
 * same `expandSections`, same `getResponse`, same frozen snapshot — so the file
 * a customer receives and the page an inspector is looking at cannot drift
 * apart. If a checkpoint is worth showing on screen it is in here, and the
 * ordering is the screen's ordering.
 *
 * No measurement and no drawing happens here. This is the list; `layout.ts`
 * decides where it breaks and `render.ts` puts ink on it.
 */
import {
  VISIT_TYPE_LABELS,
  deficiencies,
  expandSections,
  formatDate,
  formatDateTime,
  getResponse,
  isYesNo,
  overallProgress,
  sectionProgress,
  skippedBlocks,
} from '../inspection';
import type { Answer, Customer, FieldDef, Inspection, Question, Section } from '../types';

/**
 * The structural part of a checklist this needs, rather than `TemplateSnapshot`
 * itself. A signed inspection carries its own frozen snapshot and an in-progress
 * one resolves against the live template; both satisfy this, and neither has to
 * be converted into the other to produce a PDF.
 */
export interface ChecklistLike {
  templateName: string;
  infoFields: FieldDef[];
  sections: Section[];
}

/** How a checkpoint's answer is drawn beside it. */
export interface Mark {
  answer: Answer | null;
  /**
   * A checkpoint that records a fact rather than a standard. A red cross beside
   * "Gas-fired appliance on site — No" reads as a failure to anybody skimming,
   * when what it says is that there is no gas appliance.
   */
  muted?: boolean;
}

export type Element =
  | { kind: 'heading'; text: string; meta?: string; tone?: 'pass' | 'fail' | 'warn' }
  | { kind: 'stats'; items: { label: string; value: number; tone: string }[]; footnote: string }
  | { kind: 'fields'; items: { label: string; value: string }[] }
  | { kind: 'paragraph'; text: string }
  | {
      kind: 'checkpoint';
      mark: Mark;
      text: string;
      /** Serial and model numbers, drawn monospaced on their own line. */
      serial?: string;
      note?: string;
      failed?: boolean;
      photoIds: string[];
    }
  | { kind: 'measurement'; text: string; value: string }
  | { kind: 'row'; text: string; sub?: string }
  | {
      kind: 'signatures';
      blocks: { label: string; name?: string; signedAt?: string; dataUrl?: string }[];
    };

export interface ReportDocument {
  /** Used for the file name. */
  slug: string;
  header: {
    companyName: string;
    logo?: string;
    title: string;
    meta?: string;
  };
  /** Repeated in the footer of every page, so a loose sheet is identifiable. */
  footer: string;
  elements: Element[];
}

function fileSlug(value: string): string {
  return value
    .replace(/[^\w-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();
}

export function buildReportDocument(input: {
  inspection: Inspection;
  checklist: ChecklistLike;
  customer?: Customer;
  companyName: string;
  logo?: string;
}): ReportDocument {
  const { inspection, checklist, customer, companyName, logo } = input;
  const sections = checklist.sections;
  const progress = overallProgress(inspection, sections);
  const completed = inspection.status === 'completed';
  const visit = VISIT_TYPE_LABELS[inspection.visitType];
  const elements: Element[] = [];

  elements.push({
    kind: 'stats',
    items: [
      { label: 'Passed', value: progress.passed, tone: 'pass' },
      { label: 'Failed', value: progress.failed, tone: 'fail' },
      { label: 'N/A', value: progress.na, tone: 'neutral' },
      { label: 'Unanswered', value: progress.total - progress.answered, tone: 'warn' },
    ],
    footnote: completed
      ? `Signed off ${formatDateTime(inspection.completedAt)}`
      : `In progress — last updated ${formatDateTime(inspection.updatedAt)}`,
  });

  // Everything that failed, gathered and put first — the same list the screen
  // opens with, built from the same `deficiencies()` read so the file and the
  // page cannot disagree about what has to be fixed. The sections further down
  // still carry each failure in context; this is so nobody has to hunt six
  // pages of green marks to find the three red ones.
  const failures = deficiencies(inspection, sections);
  if (failures.length > 0) {
    elements.push({
      kind: 'heading',
      text: 'Deficiencies',
      meta: `${failures.length} to address`,
      tone: 'fail',
    });
    for (const item of failures) {
      const note = item.response.note?.trim();
      elements.push({
        kind: 'row',
        text: `${item.question.text}${item.question.critical ? '  (critical)' : ''}`,
        sub: [item.sectionTitle, note || 'No explanation recorded.'].join(' — '),
      });
    }
  }

  const fields = checklist.infoFields
    .map((field) => ({
      label: field.label,
      value: (inspection.info[field.id] ?? '').trim(),
      type: field.type,
    }))
    .filter((field) => field.value.length > 0)
    .map((field) => ({
      label: field.label,
      value: field.type === 'date' ? formatDate(field.value) : field.value,
    }));

  if (fields.length > 0) {
    elements.push({ kind: 'heading', text: 'Job Information' });
    elements.push({ kind: 'fields', items: fields });
  }

  if (inspection.summaryNotes?.trim()) {
    elements.push({ kind: 'heading', text: 'Summary Notes' });
    elements.push({ kind: 'paragraph', text: inspection.summaryNotes.trim() });
  }

  for (const rendered of expandSections(inspection, sections)) {
    const stats = sectionProgress(inspection, rendered.section, rendered.instanceId);
    elements.push({
      kind: 'heading',
      text: rendered.title,
      meta: stats.failed > 0 ? `${stats.failed} failed` : 'All clear',
      tone: stats.failed > 0 ? 'fail' : 'pass',
    });

    for (const question of rendered.section.questions as Question[]) {
      const response = getResponse(inspection, question.id, rendered.instanceId);

      if (!isYesNo(question)) {
        elements.push({
          kind: 'measurement',
          text: question.text,
          value: response.value?.trim()
            ? `${response.value.trim()}${question.unit ? ` ${question.unit}` : ''}`
            : '—',
        });
        continue;
      }

      elements.push({
        kind: 'checkpoint',
        mark: { answer: response.answer, muted: question.informational },
        text: question.text,
        serial: question.scannable ? response.value?.trim() || undefined : undefined,
        note: response.note?.trim() || undefined,
        failed: response.answer === 'no' && !question.informational,
        photoIds: response.photoIds,
      });
    }
  }

  // What the checklist did not ask, and why. A conditional block that simply
  // vanishes leaves a report nobody can audit: a year later, a question skipped
  // because it did not apply and one quietly dropped from the template look
  // identical — absent.
  const skipped = skippedBlocks(inspection, sections);
  if (skipped.length > 0) {
    elements.push({
      kind: 'heading',
      text: 'Not applicable to this job',
      meta: String(skipped.length),
    });
    for (const entry of skipped) {
      elements.push({ kind: 'row', text: entry.label, sub: entry.reason });
    }
  }

  if (inspection.reopenings?.length) {
    elements.push({
      kind: 'heading',
      text: 'Reopened after signing',
      meta: String(inspection.reopenings.length),
      tone: 'warn',
    });
    for (const entry of inspection.reopenings) {
      elements.push({
        kind: 'row',
        text: entry.reason,
        sub: `${formatDateTime(entry.at)}${entry.by ? ` · ${entry.by}` : ''}`,
      });
    }
  }

  elements.push({ kind: 'heading', text: 'Signatures' });
  elements.push({
    kind: 'signatures',
    blocks: [
      {
        label: 'Inspector',
        name: inspection.inspectorSignature?.name,
        signedAt: inspection.inspectorSignature
          ? formatDateTime(inspection.inspectorSignature.signedAt)
          : undefined,
        dataUrl: inspection.inspectorSignature?.dataUrl,
      },
      {
        label: 'Customer',
        name: inspection.customerSignature?.name,
        signedAt: inspection.customerSignature
          ? formatDateTime(inspection.customerSignature.signedAt)
          : undefined,
        dataUrl: inspection.customerSignature?.dataUrl,
      },
    ],
  });

  const customerName = customer?.customerName ?? 'Inspection';

  return {
    // The tail of the id, not the head: every id starts `insp_`, so the first
    // characters are the same on every record and two reports for one customer
    // would land on the same file name.
    slug: `${fileSlug(customerName)}-${fileSlug(checklist.templateName)}-${inspection.id.slice(-8)}`,
    header: {
      companyName,
      logo,
      title: `${checklist.templateName} — ${visit}`,
      meta: [customerName, customer?.address].filter(Boolean).join(' · '),
    },
    footer: [customerName, checklist.templateName, formatDate(inspection.completedAt ?? inspection.updatedAt)]
      .filter(Boolean)
      .join('  ·  '),
    elements,
  };
}
