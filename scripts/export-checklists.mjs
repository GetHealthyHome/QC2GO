// Generates a readable inventory of every checklist that ships with the app,
// straight from src/templates so the document cannot drift from the code.
//
// Writes docs/CHECKLISTS.md (for reading and printing) and docs/checklists.csv
// (for reviewing or marking up in a spreadsheet).
//
// Usage: npm run checklists:export
import fs from 'node:fs';
import path from 'node:path';
import { rolldown } from 'rolldown';

const OUT_DIR = 'docs';
const TMP = path.join('node_modules', '.cache', 'qc2go-templates.mjs');

// The templates are TypeScript with extensionless imports, so bundle before importing.
fs.mkdirSync(path.dirname(TMP), { recursive: true });
const bundle = await rolldown({ input: 'src/templates/index.ts', platform: 'node' });
await bundle.write({ file: TMP, format: 'esm' });
await bundle.close();

const { BUILT_IN_TEMPLATES, defaultSharedConfig, categoryLabel } = await import(
  path.resolve(TMP) + `?v=${Date.now()}`
);

const shared = defaultSharedConfig();
const universal = shared.universalSection;

const kindOf = (question) => question.kind ?? 'yesno';

function flagsOf(question) {
  const flags = [];
  if (kindOf(question) === 'measurement') {
    flags.push(`Measurement${question.unit ? ` — ${question.unit}` : ''}`);
  } else if (kindOf(question) === 'text') {
    flags.push('Text entry');
  }
  if (question.critical) flags.push('Critical');
  if (question.photoOnPass) flags.push('Photo for record');
  return flags;
}

/**
 * Renders one numbered checkpoint. Continuation lines are indented four spaces so
 * they stay inside the list item once the numbering reaches double digits, where
 * the content column shifts from 4 to 5.
 */
function renderQuestion(question, index) {
  const parts = [`${index + 1}. **${question.text}**`];
  const flags = flagsOf(question);
  if (flags.length) parts.push(`    \`${flags.join('` · `')}\``);
  if (question.help) parts.push(`    *${question.help}*`);
  // Two trailing spaces force a line break without ending the list item.
  return parts.map((part, i) => (i < parts.length - 1 ? `${part}  ` : part)).join('\n');
}

function countScored(section) {
  return section.questions.filter((q) => kindOf(q) === 'yesno').length;
}

const totals = (sections) =>
  sections.reduce(
    (acc, section) => ({
      questions: acc.questions + section.questions.length,
      scored: acc.scored + countScored(section),
    }),
    { questions: 0, scored: 0 },
  );

// ---------------------------------------------------------------- markdown ---

const md = [];
const line = (text = '') => md.push(text);

line('# QC2GO Checklists');
line();
line(
  'Every checklist that ships with the app, with all sections and checkpoints. Generated',
);
line('from `src/templates/` — run `npm run checklists:export` to refresh.');
line();
line('> **This lists the shipped checklists only.** Admins can edit checklists and');
line('> add their own in the app; those live in that device\'s local storage and are');
line('> not reflected here. A checklist edited in the app no longer matches this');
line('> document until the change is made in `src/templates/` as well.');
line();

line('## Every checklist opens with these two blocks');
line();
line(
  `Prepended automatically to all ${BUILT_IN_TEMPLATES.length} checklists, so a company-wide change is made once.`,
);
line();

line('### 1. Job Information');
line();
line('| Field | Type | Required | Prefilled from job |');
line('| --- | --- | :---: | --- |');
for (const field of shared.infoFields) {
  const type = field.type === 'select' ? `select (${(field.options ?? []).join(', ')})` : field.type;
  line(
    `| ${field.label} | ${type} | ${field.required ? 'Yes' : '—'} | ${field.fromJob ?? '—'} |`,
  );
}
line();

line(`### 2. ${universal.title}`);
line();
if (universal.description) line(`*${universal.description}*`);
line();
universal.questions.forEach((question, index) => line(renderQuestion(question, index)));
line();

line('## Summary');
line();
line('| # | Checklist | Category | Sections | Yes/No checkpoints | Measurements | Total items |');
line('| :-: | --- | --- | :-: | :-: | :-: | :-: |');
BUILT_IN_TEMPLATES.forEach((template, index) => {
  const sections = [universal, ...template.sections];
  const t = totals(sections);
  line(
    `| ${index + 1} | ${template.name} | ${categoryLabel(template.category)} | ${sections.length} | ${t.scored} | ${t.questions - t.scored} | ${t.questions} |`,
  );
});
line();
line(
  '*Counts include the shared Universal QC Standards section, which runs first on every checklist.*',
);
line();

for (const template of BUILT_IN_TEMPLATES) {
  const t = totals([universal, ...template.sections]);
  line('---');
  line();
  line(`## ${template.name}`);
  line();
  line(`**Category:** ${categoryLabel(template.category)}  `);
  line(`**Use for:** ${template.summary}  `);
  line(
    `**Size:** ${template.sections.length} system sections (${t.questions} items including the universal block)`,
  );
  line();
  line(`> Runs after **${universal.title}**.`);
  line();

  for (const section of template.sections) {
    line(`### ${section.title}`);
    line();
    if (section.description) {
      line(`*${section.description}*`);
      line();
    }
    section.questions.forEach((question, index) => line(renderQuestion(question, index)));
    line();
  }
}

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(path.join(OUT_DIR, 'CHECKLISTS.md'), md.join('\n'));

// --------------------------------------------------------------------- csv ---

const escape = (value) => {
  const text = String(value ?? '');
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

const rows = [
  [
    'checklist',
    'checklist_id',
    'section',
    'section_id',
    'checkpoint_id',
    'checkpoint',
    'type',
    'unit',
    'critical',
    'photo_for_record',
    'guidance',
  ],
];

function addRows(checklistName, checklistId, sections) {
  for (const section of sections) {
    for (const question of section.questions) {
      rows.push([
        checklistName,
        checklistId,
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
}

// The universal block is listed once on its own rather than repeated per checklist.
addRows('(shared) Universal QC Standards', 'shared', [universal]);
for (const template of BUILT_IN_TEMPLATES) {
  addRows(template.name, template.id, template.sections);
}

fs.writeFileSync(
  path.join(OUT_DIR, 'checklists.csv'),
  rows.map((row) => row.map(escape).join(',')).join('\n') + '\n',
);

const grand = rows.length - 1;
console.log(`docs/CHECKLISTS.md   ${BUILT_IN_TEMPLATES.length} checklists + shared block`);
console.log(`docs/checklists.csv  ${grand} checkpoints`);
