/**
 * Checklists in and out of a spreadsheet.
 *
 * Authoring a sixty-checkpoint checklist one field at a time on a phone is
 * possible and nobody wants to do it. This is the other way in: export what is
 * already there, edit it where editing is easy, and upload the result. The
 * format is `checklistCsv.ts`, and the same file works in both directions —
 * what comes out of Export is exactly what Upload expects back.
 *
 * ## Nothing lands until it has been read
 *
 * A file is parsed and summarised, and *then* an admin presses Apply. That is
 * the same rule as the rest of the editor, and it matters more here than
 * anywhere else: one upload can rewrite every checklist in the company, and the
 * difference between adding two and replacing forty is a column somebody did
 * not notice was still filled in. So the summary says, per checklist, whether
 * it is new or being replaced and by how many checkpoints, before anything is
 * written.
 *
 * ## Replaced, not merged
 *
 * A checklist named in the file is rewritten to match the file: its sections
 * become the file's sections, in the file's order. Merging would be kinder to a
 * partial upload and far worse to reason about — a deleted row would silently
 * do nothing, so removing a checkpoint would be impossible through the one
 * route that makes bulk editing worth doing. What the file says is what the
 * checklist becomes.
 *
 * Checklists the file does not mention are left alone entirely. This is not a
 * "replace my library" button.
 */
import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../lib/store';
import {
  type ParseResult,
  type ParsedChecklist,
  blankChecklistCsvRows,
  checklistCsvRows,
  parseChecklistCsv,
} from '../lib/checklistCsv';
import { downloadCsv, exportFilename, toCsv } from '../lib/exportCsv';
import { categoryLabel } from '../templates';
import { Badge, Button, Card, Screen, TopBar } from '../components/ui';
import { AlertIcon, ClipboardIcon, PlusIcon } from '../components/Icons';

export function ChecklistImportScreen() {
  const navigate = useNavigate();
  const { templates, shared, isAdmin, createTemplate, saveTemplate, saveShared } = useStore();

  const fileInput = useRef<HTMLInputElement>(null);
  const [filename, setFilename] = useState<string | null>(null);
  const [result, setResult] = useState<ParseResult | null>(null);
  const [applying, setApplying] = useState(false);

  if (!isAdmin) {
    return (
      <>
        <TopBar title="Import checklists" back="/checklists" />
        <Screen>
          <p className="text-sm text-ink-500">Only an admin can change checklists.</p>
        </Screen>
      </>
    );
  }

  function exportAll() {
    downloadCsv(exportFilename('checklists'), toCsv(checklistCsvRows(templates, shared)));
  }

  function downloadTemplate() {
    downloadCsv('qc2go-checklist-template.csv', toCsv(blankChecklistCsvRows()));
  }

  async function pick(file: File) {
    setFilename(file.name);
    setResult(parseChecklistCsv(await file.text()));
  }

  /** Whether this row of the summary replaces something or adds something. */
  function existing(entry: ParsedChecklist) {
    return entry.id ? templates.find((template) => template.id === entry.id) : undefined;
  }

  async function apply() {
    if (!result || applying) return;
    setApplying(true);
    try {
      // Categories the file introduced, added to the company's list so the
      // dropdown in the editor agrees with what the checklists now say.
      const known = new Set(shared.categories);
      const added: string[] = [];

      for (const entry of result.checklists) {
        const category = entry.category.trim();
        if (category && !known.has(category)) {
          known.add(category);
          added.push(category);
        }

        const current = existing(entry);
        if (current) {
          await saveTemplate({
            ...current,
            name: entry.name,
            category: category || current.category,
            summary: entry.description || current.summary,
            sections: entry.sections,
          });
        } else {
          await createTemplate({
            ...(entry.id ? { id: entry.id } : {}),
            name: entry.name,
            category: category || 'custom',
            summary: entry.description,
            sections: entry.sections,
          });
        }
      }

      if (added.length > 0) {
        await saveShared({ ...shared, categories: [...known].sort() });
      }
      navigate('/checklists');
    } finally {
      setApplying(false);
    }
  }

  const checklists = result?.checklists ?? [];
  const totalCheckpoints = checklists.reduce((total, entry) => total + entry.checkpoints, 0);

  return (
    <>
      <TopBar
        title="Import & export"
        subtitle="Checklists as a spreadsheet"
        back="/checklists"
      />

      <Screen className="pb-10">
        <h2 className="mb-2 px-1 text-[13px] font-bold tracking-wide text-ink-500 uppercase">
          Download
        </h2>
        <Card className="p-4">
          <p className="text-[13px] leading-relaxed text-ink-500">
            The export is every checkpoint in every active checklist, one row each, with its
            type and flags. It is also exactly what Upload expects back — so the way to change a
            lot at once is to export, edit, and upload the same file.
          </p>
          <div className="mt-3 flex flex-col gap-2">
            <Button variant="secondary" block onClick={exportAll}>
              <ClipboardIcon className="size-5" />
              Export all questions (CSV)
            </Button>
            <Button variant="secondary" block onClick={downloadTemplate}>
              Download blank template
            </Button>
          </div>
          <p className="mt-2.5 text-xs leading-relaxed text-ink-400">
            Both open in Excel, Numbers and Google Sheets. The Universal QC Standards block is
            in the export for completeness and is ignored on upload — it is edited in one place
            because a change to it lands on every checklist.
          </p>
        </Card>

        <h2 className="mt-6 mb-2 px-1 text-[13px] font-bold tracking-wide text-ink-500 uppercase">
          Upload
        </h2>
        <Card className="p-4">
          <input
            ref={fileInput}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void pick(file);
              // Cleared so choosing the same file twice fires again — the
              // commonest thing to do after fixing a reported row.
              event.target.value = '';
            }}
          />
          <Button variant="secondary" block onClick={() => fileInput.current?.click()}>
            <PlusIcon className="size-5" />
            Choose a CSV file
          </Button>
          {filename ? (
            <p className="mt-2 text-center text-xs text-ink-500">{filename}</p>
          ) : (
            <p className="mt-2.5 text-xs leading-relaxed text-ink-400">
              Columns are matched by name, so you can reorder them or delete ones you do not
              use. Only <span className="font-semibold">checklist</span>,{' '}
              <span className="font-semibold">section</span> and{' '}
              <span className="font-semibold">checkpoint</span> have to be there.
            </p>
          )}
        </Card>

        {result?.fatal ? (
          <Card className="mt-3 border-fail-200 bg-fail-50 p-4">
            <p className="flex items-start gap-2 text-[13px] leading-relaxed text-fail-700">
              <AlertIcon className="size-4 shrink-0 translate-y-0.5" />
              {result.fatal}
            </p>
          </Card>
        ) : null}

        {result && !result.fatal ? (
          <>
            <h2 className="mt-6 mb-2 px-1 text-[13px] font-bold tracking-wide text-ink-500 uppercase">
              What this will do
            </h2>

            {checklists.length === 0 ? (
              <Card className="p-4">
                <p className="text-[13px] text-ink-500">
                  Nothing to import — no rows in that file described a checkpoint.
                </p>
              </Card>
            ) : (
              <ul className="flex flex-col gap-2">
                {checklists.map((entry, position) => {
                  const current = existing(entry);
                  return (
                    <Card as="li" key={`${entry.id}-${position}`} className="p-3.5">
                      <div className="flex items-start gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <Badge tone={current ? 'warn' : 'pass'}>
                              {current ? 'Replaces' : 'New'}
                            </Badge>
                            {entry.category ? (
                              <Badge tone="neutral">{categoryLabel(entry.category)}</Badge>
                            ) : null}
                          </div>
                          <p className="mt-1.5 text-[15px] leading-tight font-bold text-ink-900">
                            {entry.name}
                          </p>
                          <p className="mt-1 text-xs text-ink-500">
                            {entry.sections.length} section
                            {entry.sections.length === 1 ? '' : 's'} · {entry.checkpoints}{' '}
                            checkpoint{entry.checkpoints === 1 ? '' : 's'}
                            {current
                              ? ` · replaces ${current.sections.reduce(
                                  (total, section) => total + section.questions.length,
                                  0,
                                )} existing`
                              : ''}
                          </p>
                        </div>
                      </div>
                    </Card>
                  );
                })}
              </ul>
            )}

            {result.problems.length > 0 ? (
              <Card className="mt-3 border-warn-200 bg-warn-50 p-4">
                <p className="text-[13px] font-semibold text-warn-800">
                  {result.problems.length} row
                  {result.problems.length === 1 ? '' : 's'} could not be read and{' '}
                  {result.problems.length === 1 ? 'was' : 'were'} left out
                </p>
                <ul className="mt-2 flex flex-col gap-1">
                  {result.problems.slice(0, 12).map((problem) => (
                    <li key={problem.line} className="text-[13px] leading-snug text-warn-800">
                      <span className="font-semibold tabular-nums">Row {problem.line}</span> —{' '}
                      {problem.message}
                    </li>
                  ))}
                </ul>
                {result.problems.length > 12 ? (
                  <p className="mt-1.5 text-xs text-warn-700">
                    …and {result.problems.length - 12} more.
                  </p>
                ) : null}
              </Card>
            ) : null}

            {checklists.length > 0 ? (
              <>
                <Button
                  block
                  className="mt-4"
                  disabled={applying}
                  onClick={() => void apply()}
                >
                  {applying
                    ? 'Applying…'
                    : `Apply — ${checklists.length} checklist${
                        checklists.length === 1 ? '' : 's'
                      }, ${totalCheckpoints} checkpoint${totalCheckpoints === 1 ? '' : 's'}`}
                </Button>
                <p className="mt-2 text-center text-xs text-ink-500">
                  Checklists not named in the file are left exactly as they are.
                  {result.skipped > 0 ? ` ${result.skipped} row(s) skipped.` : ''}
                </p>
              </>
            ) : null}
          </>
        ) : null}
      </Screen>
    </>
  );
}
