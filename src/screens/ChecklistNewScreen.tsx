/**
 * Creating a checklist.
 *
 * ## Why this screen exists
 *
 * "New checklist" used to write a record called *Untitled checklist* the
 * instant it was pressed and drop the admin into the editor. Two things went
 * wrong with that, and they compounded:
 *
 *  - The library gained a placeholder before anybody had said what they wanted.
 *    Backing out — or losing the tab, or the phone locking — left it there, and
 *    the next person found a checklist nobody had written.
 *  - The editor's changes live in a draft until *Save changes* is pressed. An
 *    admin who typed a name and pressed Back had, from where they stood, named
 *    the thing they had just created; what was actually stored was still the
 *    placeholder. The name looked saved because it had been typed into the
 *    field that showed it.
 *
 * So nothing is written here until *Create checklist* is pressed. Until then
 * there is no record, which means there is nothing to leave behind and nothing
 * to half-save. Leaving with something typed asks first — see `dirty` below.
 *
 * ## Suggesting checkpoints from the name and description
 *
 * The name and the description are what an admin has already said about the
 * checklist, so the suggest panel reads them rather than asking a third time.
 * They are the brief, joined; the panel shows exactly what it is about to send,
 * because an answer is only ever as good as the description behind it.
 *
 * Accepted suggestions collect into a first section here rather than being
 * written as they are accepted. Every rule from the section editor still holds:
 * they arrive one at a time, by somebody who read them, into something that is
 * not saved yet — and the server has already discarded anything that tried to
 * state what passes.
 */
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../lib/store';
import { categoryOptions } from '../templates';
import { blankSection } from '../lib/checklist';
import type { Question } from '../lib/types';
import { CategorySelect } from '../components/CategorySelect';
import { SuggestCheckpoints } from '../components/SuggestCheckpoints';
import {
  Button,
  Card,
  Field,
  Screen,
  TextInput,
  TopBar,
  inputClass,
} from '../components/ui';
import { TrashIcon } from '../components/Icons';

/** Where the accepted suggestions land. Named for what an admin would call it. */
const FIRST_SECTION_TITLE = 'Checkpoints';

export function ChecklistNewScreen() {
  const navigate = useNavigate();
  const { templates, shared, isAdmin, createTemplate, saveShared } = useStore();

  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  const [summary, setSummary] = useState('');
  const [questions, setQuestions] = useState<Question[]>([]);
  const [creating, setCreating] = useState(false);

  const options = useMemo(() => categoryOptions(shared, templates), [shared, templates]);

  // What the model is told. The name alone is usually too thin to propose from,
  // which is the honest reason the description is worth filling in.
  const brief = useMemo(
    () => [name.trim(), summary.trim()].filter(Boolean).join(' — '),
    [name, summary],
  );

  const dirty =
    name.trim().length > 0 ||
    summary.trim().length > 0 ||
    category.length > 0 ||
    questions.length > 0;

  if (!isAdmin) {
    return (
      <>
        <TopBar title="New checklist" back="/checklists" />
        <Screen>
          <p className="text-sm text-ink-500">Only an admin can create a checklist.</p>
        </Screen>
      </>
    );
  }

  function leave() {
    if (dirty && !window.confirm('Discard this checklist? It has not been created yet.')) return;
    navigate('/checklists');
  }

  async function create() {
    const trimmed = name.trim();
    if (!trimmed || creating) return;
    setCreating(true);
    try {
      const template = await createTemplate({
        // Left unpicked it files under the same fallback `createTemplate` has
        // always used, rather than under the empty string — which would render
        // as a blank badge on the picker and group with nothing.
        name: trimmed,
        category: category || 'custom',
        summary: summary.trim(),
        // Only when something was accepted: a checklist that starts with an
        // empty section named for us is one the admin has to tidy up first.
        sections: questions.length > 0 ? [{ ...blankSection(), title: FIRST_SECTION_TITLE, questions }] : [],
      });
      navigate(`/checklists/${template.id}`, { replace: true });
    } finally {
      setCreating(false);
    }
  }

  return (
    <>
      <TopBar
        title="New checklist"
        subtitle="Nothing is saved until you create it"
        onBack={leave}
      />

      <Screen className="pb-32">
        <Card className="p-4">
          <div className="flex flex-col gap-3.5">
            <Field label="Checklist name" required>
              <TextInput
                autoFocus
                value={name}
                placeholder="e.g. Ductless Head Commissioning"
                onChange={(event) => setName(event.target.value)}
              />
            </Field>

            <CategorySelect
              value={category}
              options={options}
              onChange={setCategory}
              onAddCategory={(added) =>
                void saveShared({ ...shared, categories: [...shared.categories, added].sort() })
              }
            />

            <Field
              label="Description"
              hint="One line describing when to use this checklist. Also what the suggestions below are based on."
            >
              <textarea
                rows={2}
                value={summary}
                placeholder="e.g. Commissioning checks for a ductless head — refrigerant, condensate, electrical, airflow"
                onChange={(event) => setSummary(event.target.value)}
                className={inputClass}
              />
            </Field>
          </div>
        </Card>

        <div className="mt-6 mb-2.5 px-1">
          <h2 className="text-[13px] font-bold tracking-wide text-ink-500 uppercase">
            Starting checkpoints
          </h2>
          <p className="mt-1 text-[13px] text-ink-500">
            Optional. Sections and checkpoints can be added in the editor once the checklist
            exists — this is just a head start.
          </p>
        </div>

        <Card className="p-3">
          {questions.length === 0 ? (
            <p className="px-1 py-2 text-[13px] text-ink-500">
              None yet.
            </p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {questions.map((question) => (
                <li
                  key={question.id}
                  className="flex items-start gap-2 rounded-xl bg-ink-50 px-3 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-[14px] leading-snug text-ink-900">{question.text}</p>
                    {question.help ? (
                      <p className="mt-0.5 text-[12px] text-ink-500">{question.help}</p>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    aria-label={`Remove ${question.text}`}
                    onClick={() =>
                      setQuestions((current) =>
                        current.filter((candidate) => candidate.id !== question.id),
                      )
                    }
                    className="flex size-8 shrink-0 items-center justify-center rounded-lg text-fail-600 active:bg-fail-50"
                  >
                    <TrashIcon className="size-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}

          <SuggestCheckpoints
            brief={brief}
            existing={questions.map((question) => question.text)}
            isAdmin={isAdmin}
            intro="Based on the name and description above. Suggestions are added one at a time, and nothing is saved until you create the checklist."
            onAdd={(question) => setQuestions((current) => [...current, question])}
          />
        </Card>
      </Screen>

      <div className="safe-pb fixed inset-x-0 bottom-0 z-30 border-t border-ink-200 bg-white/95 backdrop-blur no-print">
        <div className="mx-auto flex w-full max-w-3xl items-center gap-2 px-3 py-3">
          <Button variant="secondary" className="px-4" onClick={leave}>
            Cancel
          </Button>
          <Button
            className="flex-1"
            disabled={!name.trim() || creating}
            onClick={() => void create()}
          >
            {creating ? 'Creating…' : 'Create checklist'}
          </Button>
        </div>
      </div>
    </>
  );
}
