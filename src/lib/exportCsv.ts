/**
 * Getting results out as a spreadsheet.
 *
 * The office wants a file, not a dashboard: one row per inspection to see how
 * the month went, and one row per checkpoint to pivot on which questions fail
 * most often. Both are built from what the device already holds, so this works
 * with no signal — the same reason everything else here does.
 *
 * The `inspection_summary` view is the other half of this and lives in the
 * database for anything pointing a BI tool at Postgres. This is for the person
 * who wants the file now.
 */
import type { Customer, Inspection, SharedConfig, Template } from './types';
import { expandSections, getResponse, isScored, responseKey, scoreOf, ANSWER_LABELS } from './inspection';
import { resolveChecklist } from './checklist';
import { punchKey } from './types';

/**
 * One CSV field.
 *
 * Excel decides a field is a formula if it starts with `=`, `+`, `-` or `@`,
 * and will happily run it. A checkpoint answer that begins with a minus sign is
 * ordinary in this app — "-2 °F delta" — so every field that could be read that
 * way is prefixed with a tab, which Excel drops on display and never executes.
 */
export function csvField(value: unknown): string {
  if (value === null || value === undefined) return '';
  const text = String(value);
  const dangerous = /^[=+\-@\t\r]/.test(text);
  const escaped = (dangerous ? `\t${text}` : text).replace(/"/g, '""');
  return /[",\n\r\t]/.test(escaped) ? `"${escaped}"` : escaped;
}

export function toCsv(rows: Array<Array<unknown>>): string {
  // CRLF and a byte-order mark: without the BOM Excel reads a UTF-8 file as
  // Latin-1 and turns every ° and é into mojibake, which is exactly the kind of
  // thing nobody reports and everybody works around.
  return `﻿${rows.map((row) => row.map(csvField).join(',')).join('\r\n')}\r\n`;
}

const INSPECTION_HEADERS = [
  'Inspection ID',
  'Customer',
  'Address',
  'Salesperson',
  'Team leader',
  'Checklist',
  'Visit type',
  'Visit date',
  'Inspector',
  'Completed at',
  'Score %',
  'Result',
  'Passed',
  'Failed',
  'N/A',
  'Critical failures',
  'Deficiencies',
  'Open deficiencies',
];

/**
 * One row per completed inspection.
 *
 * The stored score is used where there is one — it is what a webhook and a
 * dashboard already report, and a spreadsheet disagreeing with them would be
 * worse than a spreadsheet with a gap. Older records signed before scores were
 * stored fall back to computing it, which is the same arithmetic.
 */
export function inspectionRows(
  inspections: Inspection[],
  customers: Customer[],
  templates: Template[],
  shared: SharedConfig,
): Array<Array<unknown>> {
  const byId = new Map(customers.map((customer) => [customer.id, customer]));
  const rows: Array<Array<unknown>> = [INSPECTION_HEADERS];

  for (const inspection of inspections) {
    if (inspection.status !== 'completed') continue;
    const checklist = resolveChecklist(inspection, templates, shared);
    if (!checklist) continue;

    const customer = byId.get(inspection.customerId);
    const score = scoreOf(inspection, checklist.sections);

    let passed = 0;
    let failed = 0;
    let notApplicable = 0;
    let openDeficiencies = 0;
    for (const rendered of expandSections(inspection, checklist.sections)) {
      for (const question of rendered.section.questions) {
        if (!isScored(question)) continue;
        const answer = getResponse(inspection, question.id, rendered.instanceId).answer;
        if (answer === 'yes') passed += 1;
        if (answer === 'na') notApplicable += 1;
        if (answer === 'no') {
          failed += 1;
          const key = punchKey(inspection.id, responseKey(question.id, rendered.instanceId));
          if (!customer?.punchResolutions?.[key]) openDeficiencies += 1;
        }
      }
    }

    rows.push([
      inspection.id,
      customer?.customerName ?? '',
      customer?.address ?? '',
      customer?.salesperson ?? '',
      customer?.teamLeader ?? '',
      checklist.templateName,
      inspection.visitType,
      inspection.visitDate,
      inspection.info.inspector ?? '',
      inspection.completedAt ?? '',
      inspection.overallScore ?? score.percent,
      inspection.passFailStatus ?? '',
      passed,
      failed,
      notApplicable,
      score.criticalFailures,
      inspection.totalDeficiencies ?? failed,
      openDeficiencies,
    ]);
  }

  return rows;
}

const CHECKPOINT_HEADERS = [
  'Inspection ID',
  'Customer',
  'Visit date',
  'Checklist',
  'Section',
  'Instance',
  'Checkpoint',
  'Critical',
  'Answer',
  'Value',
  'Explanation',
  'Photos',
  'Corrected',
];

/**
 * One row per checkpoint, across every completed inspection.
 *
 * This is the one that answers "which questions do we fail most often?" — a
 * pivot table over this column set is the whole point, and it is a question
 * nobody can ask of the app itself today.
 *
 * Each row is read through the inspection's own frozen snapshot, so a
 * checkpoint reworded last month still appears here with the wording that was
 * actually asked at the time.
 */
export function checkpointRows(
  inspections: Inspection[],
  customers: Customer[],
  templates: Template[],
  shared: SharedConfig,
): Array<Array<unknown>> {
  const byId = new Map(customers.map((customer) => [customer.id, customer]));
  const rows: Array<Array<unknown>> = [CHECKPOINT_HEADERS];

  for (const inspection of inspections) {
    if (inspection.status !== 'completed') continue;
    const checklist = resolveChecklist(inspection, templates, shared);
    if (!checklist) continue;
    const customer = byId.get(inspection.customerId);

    for (const rendered of expandSections(inspection, checklist.sections)) {
      for (const question of rendered.section.questions) {
        const response = getResponse(inspection, question.id, rendered.instanceId);
        // Unanswered and unmeasured checkpoints are noise in a pivot: a
        // completed inspection has answered every scored question anyway, and
        // an empty measurement says nothing.
        if (!response.answer && !response.value?.trim()) continue;

        const key = punchKey(inspection.id, responseKey(question.id, rendered.instanceId));
        const resolved = customer?.punchResolutions?.[key];
        rows.push([
          inspection.id,
          customer?.customerName ?? '',
          inspection.visitDate,
          checklist.templateName,
          rendered.section.title,
          // Its own column rather than folded into the section name: a pivot
          // over "which head fails most" is the reason this export exists.
          rendered.instanceId ? rendered.title.split(' — ').slice(1).join(' — ') : '',
          question.text,
          question.critical ? 'Yes' : '',
          response.answer ? ANSWER_LABELS[response.answer] : '',
          response.value ?? '',
          response.note ?? '',
          response.photoIds.length,
          response.answer === 'no' ? (resolved ? 'Yes' : 'No') : '',
        ]);
      }
    }
  }

  return rows;
}

/** `qc2go-inspections-2026-08-12.csv` */
export function exportFilename(kind: string): string {
  return `qc2go-${kind}-${new Date().toISOString().slice(0, 10)}.csv`;
}

/**
 * Hand a generated file to the browser.
 *
 * The link has to be in the document before it is clicked. A detached anchor
 * works in some browsers and is silently ignored in others, which is the worst
 * possible outcome for a download: no file, no error, nothing to report.
 *
 * The object URL is released on the next tick rather than immediately — Safari
 * in particular reads it after the click returns, and revoking it first leaves
 * the user with an empty file.
 */
export function downloadFile(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.style.display = 'none';
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function downloadCsv(filename: string, csv: string): void {
  downloadFile(filename, new Blob([csv], { type: 'text/csv;charset=utf-8' }));
}
