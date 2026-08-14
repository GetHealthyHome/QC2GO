/**
 * The punch list: everything still open on a customer, across every visit.
 *
 * A deficiency has always been visible on the inspection that found it. What
 * nobody could see was the whole job at once — so on a return visit an
 * inspector opened past inspections one at a time to work out what they were
 * there to re-check. The data was all there; the view was not.
 *
 * Nothing new is stored to make this work. A punch item *is* a failed
 * checkpoint, read back through the snapshot the inspection froze when it
 * started. That matters: the wording shown here is the wording the inspector
 * actually saw and failed, not whatever the checklist says today.
 */
import type {
  Customer,
  Inspection,
  PunchResolution,
  Question,
  Response,
  SharedConfig,
  Template,
} from './types';
import { punchKey } from './types';
import {
  expandSections,
  getResponse,
  isDeficiencyDocumented,
  isScored,
  responseKey,
} from './inspection';
import { resolveChecklist } from './checklist';

export interface PunchItem {
  inspectionId: string;
  /** The day the inspection covered, not the day the item was written. */
  visitDate: string;
  sectionId: string;
  sectionTitle: string;
  question: Question;
  response: Response;
  /** Failing a critical checkpoint is a different kind of open item. */
  critical: boolean;
  /** Where this item's resolution lives on the customer, if it has one. */
  key: string;
  resolution?: PunchResolution;
}

export interface PunchList {
  open: PunchItem[];
  resolved: PunchItem[];
  /** Open items on checkpoints marked critical — the ones that hold a job. */
  criticalOpen: number;
}

/**
 * Every failed checkpoint across a customer's inspections.
 *
 * Only completed inspections are read. An inspection still being walked has
 * failures in it that the inspector is standing in front of and about to
 * document; listing those as punch items would mean the list is never empty and
 * therefore never trusted.
 */
export function punchListFor(
  customer: Customer | undefined,
  inspections: Inspection[],
  templates: Template[],
  shared: SharedConfig,
): PunchList {
  const resolutions = customer?.punchResolutions ?? {};
  const open: PunchItem[] = [];
  const resolved: PunchItem[] = [];

  for (const inspection of inspections) {
    if (inspection.status !== 'completed') continue;

    const checklist = resolveChecklist(inspection, templates, shared);
    if (!checklist) continue;

    for (const rendered of expandSections(inspection, checklist.sections)) {
      for (const question of rendered.section.questions) {
        // "No gas appliance on site" is an answer, not a punch item — the same
        // rule `deficiencies()` applies, and it was missing here. An
        // informational checkpoint answered No is a fact about the job, and
        // listing it as something to correct puts work on the list that nobody
        // can ever close.
        if (!isScored(question)) continue;
        const response = getResponse(inspection, question.id, rendered.instanceId);
        if (response.answer !== 'no') continue;

        // Keyed by the response rather than the question, so failing the same
        // checkpoint on two different heads is two punch items and correcting
        // one does not close the other.
        const key = punchKey(inspection.id, responseKey(question.id, rendered.instanceId));
        const item: PunchItem = {
          inspectionId: inspection.id,
          visitDate: inspection.visitDate,
          sectionId: rendered.section.id,
          sectionTitle: rendered.title,
          question,
          response,
          critical: question.critical === true,
          key,
          resolution: resolutions[key],
        };
        (item.resolution ? resolved : open).push(item);
      }
    }
  }

  const byDateDescending = (a: PunchItem, b: PunchItem) => b.visitDate.localeCompare(a.visitDate);

  // Critical items first, then most recent. Somebody scanning this list on the
  // way to a re-check should meet the thing that holds the job at the top.
  open.sort((a, b) => Number(b.critical) - Number(a.critical) || byDateDescending(a, b));
  resolved.sort(byDateDescending);

  return {
    open,
    resolved,
    criticalOpen: open.filter((item) => item.critical).length,
  };
}

/** Open items that were never documented properly — no explanation, or no photo. */
export function undocumented(items: PunchItem[]): PunchItem[] {
  return items.filter((item) => !isDeficiencyDocumented(item.response));
}
