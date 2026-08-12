import type {
  Answer,
  Condition,
  FieldDef,
  Inspection,
  Question,
  Response,
  Section,
  SectionInstance,
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

/**
 * Answered with the Yes / No / N-A tiles.
 *
 * Not the same question as whether it counts. An informational checkpoint —
 * "Gas-fired appliance on site" — is answered exactly like a standard and
 * scored like nothing at all, so the two ideas need separate names. Conflating
 * them is how a routing question ends up demanding a photograph of an appliance
 * that is not there.
 */
export function isYesNo(question: Question): boolean {
  return (question.kind ?? 'yesno') === 'yesno';
}

/** Counts toward the score, and can become a deficiency. */
export function isScored(question: Question): boolean {
  return isYesNo(question) && !question.informational;
}

/**
 * Where a question's answer lives.
 *
 * Bare question id outside a repeatable section, and `<questionId>#<instanceId>`
 * inside one. Composite keys rather than a nested map so that every inspection
 * signed before repeatable sections existed still reads exactly as it did — an
 * old record has no instances, so every key is a bare question id and nothing
 * about it has moved.
 */
export function responseKey(questionId: string, instanceId?: string): string {
  return instanceId ? `${questionId}#${instanceId}` : questionId;
}

export function getResponse(
  inspection: Inspection,
  questionId: string,
  instanceId?: string,
): Response {
  return inspection.responses[responseKey(questionId, instanceId)] ?? EMPTY_RESPONSE;
}

/**
 * A section as it actually appears in one inspection: once, or once per
 * instance of a repeatable one.
 *
 * Every aggregate below iterates this rather than the raw sections, which is
 * what makes them instance-aware without each of them knowing how instances
 * work. A caller that renders sections itself should use it for the same
 * reason.
 */
export interface RenderedSection {
  section: Section;
  /** Absent when the section is not repeatable. */
  instanceId?: string;
  /** "Head 2", or whatever the inspector named it. */
  title: string;
  /** 1-based, for the default name. */
  position: number;
  /** Unique per rendered block, for React keys and for step navigation. */
  key: string;
}

/** Short and local: an instance id only has to be unique inside one inspection. */
export function newInstanceId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID().slice(0, 8)
    : Math.random().toString(36).slice(2, 10);
}

export function instancesOf(inspection: Inspection, section: Section): SectionInstance[] {
  return inspection.sectionInstances?.[section.id] ?? [];
}

export function instanceTitle(section: Section, instance: SectionInstance, position: number): string {
  if (instance.label?.trim()) return instance.label.trim();
  return `${section.instanceNoun?.trim() || 'Item'} ${position}`;
}

/**
 * Whether a condition is currently satisfied.
 *
 * An unanswered controlling question means "no": a conditional block appears
 * once the question it depends on has been answered, and until then it is
 * neither asked nor counted.
 *
 * The instance lookup falls back to the bare key so that a condition works
 * whether the controlling checkpoint sits inside the same repeatable instance
 * ("if this head has a condensate pump") or in a plain section elsewhere on the
 * checklist ("if the system is a heat pump"). Instance first, because the nearer
 * answer is the one that was meant.
 */
export function conditionMet(
  inspection: Inspection,
  condition: Condition | undefined,
  instanceId?: string,
): boolean {
  if (!condition) return true;
  const answer =
    getResponse(inspection, condition.questionId, instanceId).answer ??
    getResponse(inspection, condition.questionId).answer;
  return answer !== null && answer !== undefined && condition.answerIn.includes(answer);
}

/**
 * The questions of a section that currently apply.
 *
 * Every aggregate reaches this, and it is idempotent — filtering an
 * already-filtered section changes nothing — precisely so it does not matter
 * whether a caller hands over a raw section or one that came back from
 * `expandSections`. A rule this important is worth being unable to skip.
 */
export function visibleQuestions(
  inspection: Inspection,
  section: Section,
  instanceId?: string,
): Question[] {
  if (!section.questions.some((question) => question.showIf)) return section.questions;
  return section.questions.filter((question) =>
    conditionMet(inspection, question.showIf, instanceId),
  );
}

export function expandSections(
  inspection: Inspection,
  sections: Section[],
): RenderedSection[] {
  const rendered: RenderedSection[] = [];
  for (const section of sections) {
    // A section that does not apply is not rendered, not answered, not scored
    // and not a blocker — the whole point of asking the question that hid it.
    if (!conditionMet(inspection, section.showIf)) continue;

    if (!section.repeatable) {
      rendered.push({
        section: withVisibleQuestions(inspection, section),
        title: section.title,
        position: 1,
        key: section.id,
      });
      continue;
    }
    // A repeatable section with no instances yet contributes nothing to answer
    // and nothing to score. It is a prompt to add one, which the runner shows.
    instancesOf(inspection, section).forEach((instance, index) => {
      rendered.push({
        section: withVisibleQuestions(inspection, section, instance.id),
        instanceId: instance.id,
        title: `${section.title} — ${instanceTitle(section, instance, index + 1)}`,
        position: index + 1,
        key: `${section.id}#${instance.id}`,
      });
    });
  }
  return rendered;
}

/** The same section with the questions that do not currently apply removed. */
function withVisibleQuestions(
  inspection: Inspection,
  section: Section,
  instanceId?: string,
): Section {
  const questions = visibleQuestions(inspection, section, instanceId);
  // Returned unchanged when nothing is conditional, so the common case does not
  // hand every consumer a new object identity on every render.
  return questions.length === section.questions.length ? section : { ...section, questions };
}

export interface Skipped {
  key: string;
  /** The section title, or the checkpoint text. */
  label: string;
  /** "Gas-fired appliance on site — answered No" */
  reason: string;
  kind: 'section' | 'question';
}

/**
 * What this checklist did not ask, and why.
 *
 * A conditional block that simply vanishes leaves a report that cannot be
 * audited: a reader a year later has no way to tell a question that was skipped
 * because it did not apply from one that was quietly dropped from the checklist,
 * or never existed. Both look identical — absent.
 *
 * So the report states them. This reads the inspection's own frozen snapshot
 * like everything else on a signed record, which means it keeps explaining
 * itself correctly even after the live checklist has been rewritten.
 */
export function skippedBlocks(inspection: Inspection, sections: Section[]): Skipped[] {
  const questionText = new Map<string, string>();
  for (const section of sections) {
    for (const question of section.questions) questionText.set(question.id, question.text);
  }

  const because = (condition: Condition): string => {
    const asked = questionText.get(condition.questionId) ?? 'An earlier checkpoint';
    const answer = getResponse(inspection, condition.questionId).answer;
    return answer
      ? `${asked} — answered ${ANSWER_LABELS[answer]}`
      : `${asked} — not answered`;
  };

  const skipped: Skipped[] = [];
  for (const section of sections) {
    if (!conditionMet(inspection, section.showIf)) {
      skipped.push({
        key: section.id,
        label: section.title,
        reason: because(section.showIf!),
        kind: 'section',
      });
      // Its questions are not listed separately: the section not applying is
      // the one fact, and repeating it per question would bury the report.
      continue;
    }
    for (const question of section.questions) {
      // Only non-repeatable sections here. Which instance of a repeatable
      // section hid which checkpoint is a level of detail nobody reading a
      // report has ever wanted.
      if (section.repeatable) continue;
      if (!conditionMet(inspection, question.showIf)) {
        skipped.push({
          key: `${section.id}#${question.id}`,
          label: question.text,
          reason: because(question.showIf!),
          kind: 'question',
        });
      }
    }
  }
  return skipped;
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

export function sectionProgress(
  inspection: Inspection,
  section: Section,
  instanceId?: string,
): SectionProgress {
  // Everything the inspector has to answer counts as work, including a routing
  // question — otherwise a checklist can read 100% done while a question that
  // is blocking sign-off sits untouched. Only the pass/fail tallies below are
  // restricted to checkpoints that are actually scored.
  const asked = visibleQuestions(inspection, section, instanceId).filter(isYesNo);
  const progress: SectionProgress = { ...ZERO_PROGRESS, total: asked.length };
  for (const question of asked) {
    const response = getResponse(inspection, question.id, instanceId);
    if (!response.answer) continue;
    progress.answered += 1;
    // A fact about the job is answered, not passed.
    if (!isScored(question)) continue;
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
  return expandSections(inspection, sections).reduce<SectionProgress>((totals, rendered) => {
    const progress = sectionProgress(inspection, rendered.section, rendered.instanceId);
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
  /** Which instance of a repeatable section this came from, if any. */
  instanceId?: string;
  /** The step to navigate back to. */
  stepKey: string;
  question: Question;
  response: Response;
}

export function deficiencies(inspection: Inspection, sections: Section[]): Deficiency[] {
  const found: Deficiency[] = [];
  for (const rendered of expandSections(inspection, sections)) {
    for (const question of rendered.section.questions) {
      // "No gas appliance on site" is an answer, not a punch item. Only a failed
      // standard is something somebody has to go back and fix.
      if (!isScored(question)) continue;
      const response = getResponse(inspection, question.id, rendered.instanceId);
      if (response.answer === 'no') {
        found.push({
          sectionId: rendered.section.id,
          sectionTitle: rendered.title,
          instanceId: rendered.instanceId,
          stepKey: rendered.key,
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
  for (const rendered of expandSections(inspection, sections)) {
    for (const question of rendered.section.questions) {
      if (!question.photoOnPass) continue;
      const response = getResponse(inspection, question.id, rendered.instanceId);
      if (response.answer === 'yes' && response.photoIds.length === 0) {
        found.push({
          sectionId: rendered.section.id,
          sectionTitle: rendered.title,
          instanceId: rendered.instanceId,
          stepKey: rendered.key,
          question,
          response,
        });
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
  instanceId?: string;
  /** The step this blocker sits in, so review can link straight back to it. */
  stepKey?: string;
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

  // A repeatable section with no instances at all is a section nobody has said
  // anything about. On a five-head job that is five sets of answers missing, so
  // it blocks sign-off in its own right rather than passing silently.
  for (const section of sections) {
    // Unless the section does not apply at all, in which case demanding an
    // instance of it would be demanding work on a system that is not there.
    if (!conditionMet(inspection, section.showIf)) continue;
    if (section.repeatable && instancesOf(inspection, section).length === 0) {
      blockers.push({
        kind: 'info',
        label: `${section.title}: add at least one ${(section.instanceNoun || 'item').toLowerCase()}`,
        sectionId: section.id,
      });
    }
  }

  for (const rendered of expandSections(inspection, sections)) {
    const { section, instanceId, key: stepKey } = rendered;
    for (const question of section.questions) {
      // Every yes/no checkpoint has to be answered, including an informational
      // one — a forgotten routing question silently skips everything downstream
      // of it, which is the one way this feature could lose a whole section of
      // an inspection without anybody noticing.
      if (!isYesNo(question)) continue;
      const response = getResponse(inspection, question.id, instanceId);
      const where = section.repeatable ? ` (${rendered.title})` : '';
      if (!response.answer) {
        blockers.push({
          kind: 'unanswered',
          label: `${question.text}${where}`,
          sectionId: section.id,
          questionId: question.id,
          instanceId,
          stepKey,
        });
        continue;
      }
      // Evidence is owed for a failed standard, not for a fact about the job.
      if (!isScored(question)) continue;
      if (response.answer === 'no') {
        if (!response.note?.trim()) {
          blockers.push({
            kind: 'explanation',
            label: `Explanation required: ${question.text}${where}`,
            sectionId: section.id,
            questionId: question.id,
            instanceId,
            stepKey,
          });
        }
        if (response.photoIds.length === 0) {
          blockers.push({
            kind: 'photo',
            label: `Photo required: ${question.text}${where}`,
            sectionId: section.id,
            questionId: question.id,
            instanceId,
            stepKey,
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
  for (const rendered of expandSections(inspection, sections)) {
    for (const question of rendered.section.questions) {
      if (!isScored(question)) continue;
      const answer = getResponse(inspection, question.id, rendered.instanceId).answer;
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
