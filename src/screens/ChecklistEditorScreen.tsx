import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useStore, useTemplate } from '../lib/store';
import { blankSection, moveItem } from '../lib/checklist';
import type { Section, Template } from '../lib/types';
import { SectionEditor } from '../components/SectionEditor';
import { Button, Card, Field, Screen, TextInput, TopBar, inputClass } from '../components/ui';
import { PlusIcon, TrashIcon } from '../components/Icons';

export function ChecklistEditorScreen() {
  const { templateId } = useParams();
  const navigate = useNavigate();
  const stored = useTemplate(templateId);
  const { isAdmin, saveTemplate, removeTemplate, duplicateTemplate, resetTemplate } = useStore();

  const [draft, setDraft] = useState<Template | undefined>(stored);
  const [openSection, setOpenSection] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Reload the draft when the stored record changes identity (e.g. after a reset).
  useEffect(() => {
    setDraft(stored);
  }, [stored?.id, stored?.updatedAt]);

  const dirty = useMemo(
    () => Boolean(draft && stored && JSON.stringify(draft) !== JSON.stringify(stored)),
    [draft, stored],
  );

  if (!stored || !draft) {
    return (
      <>
        <TopBar title="Checklist not found" back="/checklists" />
        <Screen>
          <p className="text-sm text-ink-500">That checklist is no longer on this device.</p>
        </Screen>
      </>
    );
  }

  function patch(changes: Partial<Template>) {
    setDraft((current) => (current ? { ...current, ...changes } : current));
  }

  function updateSection(index: number, section: Section) {
    setDraft((current) =>
      current
        ? { ...current, sections: current.sections.map((s, i) => (i === index ? section : s)) }
        : current,
    );
  }

  function addSection() {
    const section = blankSection();
    setDraft((current) =>
      current ? { ...current, sections: [...current.sections, section] } : current,
    );
    setOpenSection(section.id);
  }

  async function save() {
    if (!draft || saving) return;
    setSaving(true);
    try {
      await saveTemplate(draft);
    } finally {
      setSaving(false);
    }
  }

  async function handleDuplicate() {
    const copy = await duplicateTemplate(stored!.id);
    if (copy) navigate(`/checklists/${copy.id}`, { replace: true });
  }

  async function handleDelete() {
    if (!stored) return;
    const confirmed = window.confirm(
      `Delete "${stored.name}"? Inspections already run against it keep their own copy and are unaffected.`,
    );
    if (!confirmed) return;
    await removeTemplate(stored.id);
    navigate('/checklists', { replace: true });
  }

  async function handleReset() {
    if (!stored) return;
    const confirmed = window.confirm(
      `Restore "${stored.name}" to the version that shipped with the app? Your edits to it will be lost.`,
    );
    if (!confirmed) return;
    await resetTemplate(stored.id);
  }

  const totalQuestions = draft.sections.reduce(
    (total, section) => total + section.questions.length,
    0,
  );

  return (
    <>
      <TopBar
        title={isAdmin ? 'Edit checklist' : draft.name}
        subtitle={`${draft.sections.length} sections · ${totalQuestions} checkpoints`}
        back="/checklists"
      />

      <Screen className={dirty ? 'pb-32' : 'pb-10'}>
        <Card className="p-4">
          <div className="flex flex-col gap-3.5">
            <Field label="Checklist name" required>
              <TextInput
                value={draft.name}
                disabled={!isAdmin}
                onChange={(event) => patch({ name: event.target.value })}
              />
            </Field>
            <Field label="Category" hint="Groups checklists on the picker. Any text works.">
              <TextInput
                value={draft.category}
                disabled={!isAdmin}
                onChange={(event) => patch({ category: event.target.value })}
              />
            </Field>
            <Field label="Summary" hint="One line describing when to use this checklist.">
              <textarea
                rows={2}
                value={draft.summary}
                disabled={!isAdmin}
                onChange={(event) => patch({ summary: event.target.value })}
                className={inputClass}
              />
            </Field>
          </div>
        </Card>

        <div className="mt-6 mb-2.5 flex items-center justify-between px-1">
          <h2 className="text-[13px] font-bold tracking-wide text-ink-500 uppercase">
            Sections
          </h2>
          <span className="text-xs font-semibold text-ink-400">
            Universal QC Standards runs first on every checklist
          </span>
        </div>

        <div className="flex flex-col gap-2.5">
          {draft.sections.map((section, index) => (
            <SectionEditor
              key={section.id}
              section={section}
              index={index}
              total={draft.sections.length}
              readOnly={!isAdmin}
              open={openSection === section.id}
              onToggle={() =>
                setOpenSection((current) => (current === section.id ? null : section.id))
              }
              onChange={(next) => updateSection(index, next)}
              onMove={(direction) =>
                patch({ sections: moveItem(draft.sections, index, index + direction) })
              }
              onDelete={() =>
                patch({ sections: draft.sections.filter((_, i) => i !== index) })
              }
            />
          ))}
        </div>

        {isAdmin ? (
          <>
            <Button variant="secondary" block className="mt-3" onClick={addSection}>
              <PlusIcon className="size-5" />
              Add section
            </Button>

            <div className="mt-8 flex flex-col gap-2">
              <Button variant="secondary" block onClick={() => void handleDuplicate()}>
                Duplicate this checklist
              </Button>
              <Button
                variant="secondary"
                block
                onClick={() => patch({ archived: !draft.archived })}
              >
                {draft.archived ? 'Restore from archive' : 'Archive (hide from inspectors)'}
              </Button>
              {stored.builtIn ? (
                <Button variant="ghost" block onClick={() => void handleReset()}>
                  Reset to shipped version
                </Button>
              ) : (
                <button
                  type="button"
                  onClick={() => void handleDelete()}
                  className="flex w-full items-center justify-center gap-2 py-3 text-[13px] font-semibold text-fail-600"
                >
                  <TrashIcon className="size-4" />
                  Delete checklist
                </button>
              )}
            </div>
          </>
        ) : null}
      </Screen>

      {dirty && isAdmin ? (
        <div className="safe-pb fixed inset-x-0 bottom-0 z-30 border-t border-ink-200 bg-white/95 backdrop-blur no-print">
          <div className="mx-auto flex w-full max-w-3xl items-center gap-2 px-3 py-3">
            <Button variant="secondary" className="px-4" onClick={() => setDraft(stored)}>
              Discard
            </Button>
            <Button className="flex-1" disabled={saving} onClick={() => void save()}>
              {saving ? 'Saving…' : 'Save changes'}
            </Button>
          </div>
        </div>
      ) : null}
    </>
  );
}
