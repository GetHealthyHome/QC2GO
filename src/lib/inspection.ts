import type {
  Answer,
  FieldDef,
  Inspection,
  Question,
  Response,
  Section,
  VisitType,
} from './types';

export const EMPTY_RESPONSE: Response = { answer: null, photoIds: [] };

export const VISIT_TYPE_LABELS: Record<VisitType, string> = {
  'site-visit': 'Site Visit',
  'final-walkthrough': 'Final Walkthrough',
  'punch-recheck': 'Punch List Re-check',
};

export const ANSWER_LABELS: Record<Answer, string> = {
  yes: 'Yes',
  no: 'No',
  na: 'N/A',
};

export function isScored(question: Question): boolean {
  return (question.kind ?? 'yesno') === 'yesno';
}

export function getResponse(inspection: Inspection, questionId: string): Response {
  return inspection.responses[questionId] ?? EMPTY_RESPONSE;
}

/** A No answer is only complete once it carries both an explanation and a photo. */
export function isDeficiencyDocumented(response: Response): boolean {
  return Boolean(response.note?.trim()) && response.photoIds.length > 0;
}

export interface SectionProgress {
  total: number;
  answered: number;
  passed: number;
  failed: number;
  na: number;
  /** Failed items still missing their explanation or photo. */
  incomplete: number;
}

const ZERO_PROGRESS: SectionProgress = {
  total: 0,
  answered: 0,
  passed: 0,
  failed: 0,
  na: 0,
  incomplete: 0,
};

export function sectionProgress(inspection: Inspection, section: Section): SectionProgress {
  const scored = section.questions.filter(isScored);
  const progress: SectionProgress = { ...ZERO_PROGRESS, total: scored.length };
  for (const question of scored) {
    const response = getResponse(inspection, question.id);
    if (!response.answer) continue;
    progress.answered += 1;
    if (response.answer === 'yes') progress.passed += 1;
    if (response.answer === 'na') progress.na += 1;
    if (response.answer === 'no') {
      progress.failed += 1;
      if (!isDeficiencyDocumented(response)) progress.incomplete += 1;
    }
  }
  return progress;
}

export function overallProgress(inspection: Inspection, sections: Section[]): SectionProgress {
  return sections.reduce<SectionProgress>((totals, section) => {
    const progress = sectionProgress(inspection, section);
    return {
      total: totals.total + progress.total,
      answered: totals.answered + progress.answered,
      passed: totals.passed + progress.passed,
      failed: totals.failed + progress.failed,
      na: totals.na + progress.na,
      incomplete: totals.incomplete + progress.incomplete,
    };
  }, ZERO_PROGRESS);
}

export interface Deficiency {
  sectionId: string;
  sectionTitle: string;
  question: Question;
  response: Response;
}

export function deficiencies(inspection: Inspection, sections: Section[]): Deficiency[] {
  const found: Deficiency[] = [];
  for (const section of sections) {
    for (const question of section.questions) {
      const response = getResponse(inspection, question.id);
      if (response.answer === 'no') {
        found.push({
          sectionId: section.id,
          sectionTitle: section.title,
          question,
          response,
        });
      }
    }
  }
  return found;
}

/** Pass items marked as needing an evidence photo that do not have one. Advisory, not blocking. */
export function missingEvidencePhotos(inspection: Inspection, sections: Section[]): Deficiency[] {
  const found: Deficiency[] = [];
  for (const section of sections) {
    for (const question of section.questions) {
      if (!question.photoOnPass) continue;
      const response = getResponse(inspection, question.id);
      if (response.answer === 'yes' && response.photoIds.length === 0) {
        found.push({ sectionId: section.id, sectionTitle: section.title, question, response });
      }
    }
  }
  return found;
}

export type BlockerKind = 'info' | 'unanswered' | 'explanation' | 'photo' | 'signature';

export interface Blocker {
  kind: BlockerKind;
  label: string;
  sectionId?: string;
  questionId?: string;
}

/**
 * Everything standing between the current state and a signable inspection.
 * Unanswered questions and undocumented No answers are hard stops by design —
 * a QC record with a bare "No" and no evidence is worse than no record at all.
 */
export function completionBlockers(
  inspection: Inspection,
  sections: Section[],
  infoFields: FieldDef[],
): Blocker[] {
  const blockers: Blocker[] = [];

  for (const field of infoFields) {
    if (field.required && !inspection.info[field.id]?.trim()) {
      blockers.push({ kind: 'info', label: `${field.label} is required` });
    }
  }

  for (const section of sections) {
    for (const question of section.questions) {
      if (!isScored(question)) continue;
      const response = getResponse(inspection, question.id);
      if (!response.answer) {
        blockers.push({
          kind: 'unanswered',
          label: question.text,
          sectionId: section.id,
          questionId: question.id,
        });
        continue;
      }
      if (response.answer === 'no') {
        if (!response.note?.trim()) {
          blockers.push({
            kind: 'explanation',
            label: `Explanation required: ${question.text}`,
            sectionId: section.id,
            questionId: question.id,
          });
        }
        if (response.photoIds.length === 0) {
          blockers.push({
            kind: 'photo',
            label: `Photo required: ${question.text}`,
            sectionId: section.id,
            questionId: question.id,
          });
        }
      }
    }
  }

  if (!inspection.inspectorSignature) {
    blockers.push({ kind: 'signature', label: 'Inspector signature is required' });
  }
  if (
    inspection.visitType === 'final-walkthrough' &&
    inspection.info.customerPresent === 'Yes' &&
    !inspection.customerSignature
  ) {
    blockers.push({ kind: 'signature', label: 'Customer signature is required' });
  }

  return blockers;
}

export function formatDate(iso: string | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function formatDateTime(iso: string | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const seconds = Math.round((Date.now() - then) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return formatDate(iso);
}

export function todayIso(): string {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}

export interface Score {
  /** Percentage of judged items that passed. N/A items are excluded entirely. */
  percent: number;
  passed: number;
  failed: number;
  judged: number;
  /** Failed items flagged critical — a high percentage can still hide one of these. */
  criticalFailures: number;
}

/**
 * The number on a QC card. N/A is excluded rather than counted as a pass, so
 * skipping half a checklist cannot inflate the result.
 */
export function scoreOf(inspection: Inspection, sections: Section[]): Score {
  let passed = 0;
  let failed = 0;
  let criticalFailures = 0;
  for (const section of sections) {
    for (const question of section.questions) {
      if (!isScored(question)) continue;
      const answer = getResponse(inspection, question.id).answer;
      if (answer === 'yes') passed += 1;
      if (answer === 'no') {
        failed += 1;
        if (question.critical) criticalFailures += 1;
      }
    }
  }
  const judged = passed + failed;
  return {
    percent: judged === 0 ? 0 : Math.round((passed / judged) * 100),
    passed,
    failed,
    judged,
    criticalFailures,
  };
}

export type ScoreBand = 'pass' | 'watch' | 'fail';

/** A single critical failure drops the band regardless of the percentage. */
export function scoreBand(score: Score): ScoreBand {
  if (score.criticalFailures > 0) return 'fail';
  if (score.percent >= 95) return 'pass';
  if (score.percent >= 85) return 'watch';
  return 'fail';
}

/**
 * The result as anything outside the app reads it — a webhook body, a
 * spreadsheet, a BI extract. Deliberately the TRD's vocabulary rather than the
 * app's own: `watch` is a shade this app understands and an external consumer
 * does not, and "needs review" is what it actually means.
 */
export type PassFailStatus = 'PASS' | 'FAIL' | 'NEEDS_REVIEW';

const BAND_TO_STATUS: Record<ScoreBand, PassFailStatus> = {
  pass: 'PASS',
  watch: 'NEEDS_REVIEW',
  fail: 'FAIL',
};

export interface StoredSummary {
  overallScore: number;
  passFailStatus: PassFailStatus;
  totalDeficiencies: number;
}

/**
 * The result, written down at sign-off.
 *
 * Everywhere inside the app the score is derived from the responses on every
 * read, which is right — the snapshot is frozen beside them, so the number
 * cannot drift from what the inspection said. This exists for everything
 * outside it, which cannot run this code to find out.
 *
 * Computed by the same functions the UI uses, so there is one rule rather than
 * two implementations free to disagree.
 */
export function storedSummary(inspection: Inspection, sections: Section[]): StoredSummary {
  const score = scoreOf(inspection, sections);
  return {
    overallScore: score.percent,
    passFailStatus: BAND_TO_STATUS[scoreBand(score)],
    totalDeficiencies: deficiencies(inspection, sections).length,
  };
}

/** Groups inspections by the day they cover, most recent first. */
export function groupByVisitDate<T extends { visitDate: string }>(items: T[]): Array<[string, T[]]> {
  const byDate = new Map<string, T[]>();
  for (const item of items) {
    const list = byDate.get(item.visitDate) ?? [];
    list.push(item);
    byDate.set(item.visitDate, list);
  }
  return [...byDate.entries()].sort((a, b) => b[0].localeCompare(a[0]));
}
