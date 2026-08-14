/**
 * Checklists as a spreadsheet, in both directions.
 *
 * One format, defined once, used by three things that would otherwise drift:
 * the export an admin downloads, the blank template they can fill in instead,
 * and the parser that reads either one back. If those disagreed by a single
 * column name, the round trip an admin actually wants — export, edit fifty
 * checkpoints in Excel, upload — would fail on the upload, after the editing.
 *
 * ## The shape
 *
 * One row per checkpoint, with the checklist and section it belongs to repeated
 * on every row. Not the tidiest way to store a tree, and by a distance the
 * easiest to edit: sorting by section, filtering to the critical ones, or
 * pasting forty rows from another sheet all work on a flat grid and none of
 * them work on anything nested.
 *
 * Columns are matched **by name, not by position**, so an admin can reorder or
 * delete columns they do not care about and the file still reads. Only
 * `checklist`, `section` and `checkpoint` have to be there.
 *
 * ## What the parser will not do
 *
 * It will not touch the shared Universal QC Standards block. Those rows are in
 * the export because a spreadsheet of "every question" that omitted the ones
 * asked on every job would be a lie, but they are skipped on the way back in:
 * that block is edited in one place, on purpose, because a change to it lands
 * on every checklist at once.
 *
 * It also does not decide anything. Parsing returns what the file says and what
 * is wrong with it; whether any of that reaches the store is a decision made in
 * front of an admin who can see the summary first.
 */
import { newElementId } from './checklist';
import type { Question, QuestionKind, Section, SharedConfig, Template } from './types';

/** The shared block's id in the `checklist_id` column. Never imported. */
export const SHARED_ID = 'shared';

export const COLUMNS = [
  'checklist',
  'checklist_id',
  'category',
  'checklist_description',
  'section',
  'section_id',
  'checkpoint_id',
  'checkpoint',
  'type',
  'unit',
  'critical',
  'photo_for_record',
  'guidance',
] as const;

export type Column = (typeof COLUMNS)[number];

/** Without these three a row does not describe a checkpoint at all. */
const REQUIRED: Column[] = ['checklist', 'section', 'checkpoint'];

const KINDS: QuestionKind[] = ['yesno', 'measurement', 'text'];

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

const kindOf = (question: Question): QuestionKind => question.kind ?? 'yesno';

function rowsForTemplate(
  name: string,
  id: string,
  category: string,
  description: string,
  sections: Section[],
): string[][] {
  const rows: string[][] = [];
  for (const section of sections) {
    for (const question of section.questions) {
      rows.push([
        name,
        id,
        category,
        description,
        section.title,
        section.id,
        question.id,
        question.text,
        kindOf(question),
        question.unit ?? '',
        question.critical ? 'yes' : '',
        question.photoOnPass ? 'yes' : '',
        question.help ?? '',
      ]);
    }
  }
  return rows;
}

/**
 * Every checkpoint in the library, header row first.
 *
 * The shared block leads, once, rather than being repeated under every
 * checklist — it is asked on every job, and thirteen copies of it in a
 * spreadsheet is thirteen places to edit and twelve of them wrong.
 */
export function checklistCsvRows(
  templates: Template[],
  shared: SharedConfig,
  { includeArchived = false }: { includeArchived?: boolean } = {},
): string[][] {
  const rows: string[][] = [[...COLUMNS]];
  rows.push(
    ...rowsForTemplate(
      '(shared) Universal QC Standards',
      SHARED_ID,
      '',
      'Asked on every checklist. Edited under Checklists → Job Information & Universal QC Standards.',
      [shared.universalSection],
    ),
  );
  for (const template of templates) {
    if (template.archived && !includeArchived) continue;
    rows.push(
      ...rowsForTemplate(
        template.name,
        template.id,
        template.category,
        template.summary,
        template.sections,
      ),
    );
  }
  return rows;
}

/**
 * The blank an admin downloads to fill in.
 *
 * Two example rows rather than none. A header-only file leaves every question
 * the format answers — is `critical` a yes/no or a TRUE/FALSE, does a
 * measurement need a unit, what does a second section look like — to be guessed
 * at, and a guess is found out after the file is full.
 *
 * The examples carry no `checklist_id`, which is what tells the parser to make
 * a new checklist rather than overwrite one. Deleting these two rows and
 * keeping the header is a perfectly good empty file.
 */
export function blankChecklistCsvRows(): string[][] {
  return [
    [...COLUMNS],
    [
      'Ventilation Commissioning',
      '',
      'indoor-air-quality',
      'Balanced ventilation checks at commissioning.',
      'Airflow',
      '',
      '',
      'Measured exhaust airflow at the main bathroom',
      'measurement',
      'CFM',
      '',
      '',
      'Record the reading. Do not write a pass/fail threshold here.',
    ],
    [
      'Ventilation Commissioning',
      '',
      'indoor-air-quality',
      'Balanced ventilation checks at commissioning.',
      'Controls',
      '',
      '',
      'Homeowner shown how to run the ventilation controls',
      'yesno',
      '',
      'yes',
      '',
      'Walk them through it rather than pointing at the manual.',
    ],
  ];
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

/**
 * A CSV reader that survives what a spreadsheet actually produces.
 *
 * Quoted fields containing commas, quotes doubled inside them, embedded
 * newlines inside a quoted cell, CRLF endings, and Excel's UTF-8 byte-order
 * mark. Splitting on commas handles none of those, and a checkpoint with a
 * comma in it — "Permits pulled, posted on site" — is the first row of the
 * app's own export.
 */
export function parseCsv(text: string): string[][] {
  const source = text.replace(/^﻿/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  for (let at = 0; at < source.length; at += 1) {
    const char = source[at];

    if (quoted) {
      if (char === '"') {
        // A doubled quote is a literal one; a single quote ends the field.
        if (source[at + 1] === '"') {
          field += '"';
          at += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\r') {
      // Swallow; the \n that follows ends the row. A lone \r ends it too.
      if (source[at + 1] !== '\n') {
        row.push(field);
        rows.push(row);
        row = [];
        field = '';
      }
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }

  // Whatever is still in hand when the text runs out is the last field, unless
  // the file simply ended with a newline and there is nothing in hand.
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

export interface ParsedChecklist {
  /** Empty when the file did not name one — the caller mints it. */
  id: string;
  name: string;
  category: string;
  description: string;
  sections: Section[];
  checkpoints: number;
}

export interface ParseProblem {
  /** 1-based line in the file, counting the header, so it matches the sheet. */
  line: number;
  message: string;
}

export interface ParseResult {
  checklists: ParsedChecklist[];
  problems: ParseProblem[];
  /** Rows deliberately ignored: blank ones, and the shared block. */
  skipped: number;
  /** Set when the file could not be read at all, and nothing was parsed. */
  fatal?: string;
}

const truthy = (value: string): boolean =>
  ['yes', 'y', 'true', '1', 'x'].includes(value.trim().toLowerCase());

/**
 * Read a filled-in sheet back into checklists.
 *
 * Every row that can be understood is; a row that cannot is reported with its
 * line number and the rest of the file carries on. An admin who mistyped one
 * `type` cell out of two hundred should be told which cell, not handed back
 * their whole file.
 */
export function parseChecklistCsv(text: string): ParseResult {
  const problems: ParseProblem[] = [];
  const rows = parseCsv(text);
  if (rows.length === 0) {
    return { checklists: [], problems, skipped: 0, fatal: 'That file is empty.' };
  }

  const header = rows[0].map((cell) => cell.trim().toLowerCase());
  const index = new Map<string, number>();
  for (const column of COLUMNS) {
    const at = header.indexOf(column);
    if (at !== -1) index.set(column, at);
  }

  const missing = REQUIRED.filter((column) => !index.has(column));
  if (missing.length > 0) {
    return {
      checklists: [],
      problems,
      skipped: 0,
      fatal: `The header row is missing ${missing.join(', ')}. Download the template to see the columns.`,
    };
  }

  const cell = (row: string[], column: Column): string => {
    const at = index.get(column);
    return at === undefined ? '' : (row[at] ?? '').trim();
  };

  // Keyed by the id where there is one and by the name where there is not, so
  // a file that names its checklists but leaves the id column blank still
  // gathers its rows into one checklist each rather than one apiece.
  const byKey = new Map<string, ParsedChecklist>();
  const sectionsByKey = new Map<string, Map<string, Section>>();
  let skipped = 0;

  for (let at = 1; at < rows.length; at += 1) {
    const row = rows[at];
    const line = at + 1;

    if (row.every((value) => value.trim() === '')) {
      skipped += 1;
      continue;
    }

    const checklistId = cell(row, 'checklist_id');
    if (checklistId === SHARED_ID) {
      // Not an error. It is in the export on purpose and skipped here on
      // purpose; saying so once at the end is enough.
      skipped += 1;
      continue;
    }

    const checklistName = cell(row, 'checklist');
    const sectionTitle = cell(row, 'section');
    const checkpoint = cell(row, 'checkpoint');

    if (!checkpoint) {
      skipped += 1;
      continue;
    }
    if (!checklistName) {
      problems.push({ line, message: 'No checklist name on this row.' });
      continue;
    }
    if (!sectionTitle) {
      problems.push({ line, message: 'No section on this row.' });
      continue;
    }

    const rawKind = cell(row, 'type').toLowerCase();
    const kind = (rawKind || 'yesno') as QuestionKind;
    if (!KINDS.includes(kind)) {
      problems.push({
        line,
        message: `"${rawKind}" is not a checkpoint type. Use yesno, measurement or text.`,
      });
      continue;
    }

    const key = checklistId || `name:${checklistName.toLowerCase()}`;
    let checklist = byKey.get(key);
    if (!checklist) {
      checklist = {
        id: checklistId,
        name: checklistName,
        category: cell(row, 'category'),
        description: cell(row, 'checklist_description'),
        sections: [],
        checkpoints: 0,
      };
      byKey.set(key, checklist);
      sectionsByKey.set(key, new Map());
    }

    const sections = sectionsByKey.get(key)!;
    const sectionId = cell(row, 'section_id');
    const sectionKey = sectionId || `title:${sectionTitle.toLowerCase()}`;
    let section = sections.get(sectionKey);
    if (!section) {
      section = {
        id: sectionId || newElementId('s'),
        title: sectionTitle,
        questions: [],
      };
      sections.set(sectionKey, section);
      checklist.sections.push(section);
    }

    const unit = cell(row, 'unit');
    const guidance = cell(row, 'guidance');
    const question: Question = {
      id: cell(row, 'checkpoint_id') || newElementId('q'),
      text: checkpoint,
      kind,
      ...(guidance ? { help: guidance } : {}),
      // A unit on anything but a measurement is a label with nothing to label.
      ...(kind === 'measurement' && unit ? { unit } : {}),
      ...(truthy(cell(row, 'critical')) ? { critical: true } : {}),
      ...(truthy(cell(row, 'photo_for_record')) ? { photoOnPass: true } : {}),
    };

    section.questions.push(question);
    checklist.checkpoints += 1;
  }

  return { checklists: [...byKey.values()], problems, skipped };
}
