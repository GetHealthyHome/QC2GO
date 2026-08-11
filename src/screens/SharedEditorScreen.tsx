import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../lib/store';
import { moveItem, newElementId } from '../lib/checklist';
import type { FieldDef, FieldType, SharedConfig } from '../lib/types';
import { SectionEditor } from '../components/SectionEditor';
import { Button, Card, Field, Screen, TextInput, TopBar, cx, inputClass } from '../components/ui';
import { ChevronDownIcon, PlusIcon, TrashIcon } from '../components/Icons';

const FIELD_TYPES: Array<{ id: FieldType; label: string }> = [
  { id: 'text', label: 'Text' },
  { id: 'textarea', label: 'Long text' },
  { id: 'number', label: 'Number' },
  { id: 'date', label: 'Date' },
  { id: 'tel', label: 'Phone' },
  { id: 'select', label: 'Choice' },
];

export function SharedEditorScreen() {
  const { shared, isAdmin, saveShared, resetShared } = useStore();
  const [draft, setDraft] = useState<SharedConfig>(shared);
  const [openSection, setOpenSection] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDraft(shared);
  }, [shared]);

  const dirty = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(shared),
    [draft, shared],
  );

  async function save() {
    if (saving) return;
    setSaving(true);
    try {
      await saveShared(draft);
    } finally {
      setSaving(false);
    }
  }

  async function handleReset() {
    const confirmed = window.confirm(
      'Restore the shared job information fields and Universal QC Standards to the versions that shipped with the app? Your edits will be lost.',
    );
    if (confirmed) await resetShared();
  }

  function updateField(index: number, field: FieldDef) {
    setDraft((current) => ({
      ...current,
      infoFields: current.infoFields.map((f, i) => (i === index ? field : f)),
    }));
  }

  return (
    <>
      <TopBar
        title="Shared sections"
        subtitle="On every checklist"
        back="/checklists"
      />

      <Screen className={dirty ? 'pb-32' : 'pb-10'}>
        <Card className="border-brand-200 bg-brand-50 p-4">
          <p className="text-[13px] leading-relaxed text-brand-800">
            These two blocks open every checklist. A change here lands on all of them at once, for
            inspections started from now on.
          </p>
        </Card>

        <h2 className="mt-6 mb-2.5 px-1 text-[13px] font-bold tracking-wide text-ink-500 uppercase">
          Job Information fields
        </h2>
        <div className="flex flex-col gap-2">
          {draft.infoFields.map((field, index) => (
            <FieldEditor
              key={field.id}
              field={field}
              index={index}
              total={draft.infoFields.length}
              readOnly={!isAdmin}
              onChange={(next) => updateField(index, next)}
              onMove={(direction) =>
                setDraft((current) => ({
                  ...current,
                  infoFields: moveItem(current.infoFields, index, index + direction),
                }))
              }
              onDelete={() =>
                setDraft((current) => ({
                  ...current,
                  infoFields: current.infoFields.filter((_, i) => i !== index),
                }))
              }
            />
          ))}
        </div>

        {isAdmin ? (
          <Button
            variant="secondary"
            block
            className="mt-3"
            onClick={() =>
              setDraft((current) => ({
                ...current,
                infoFields: [
                  ...current.infoFields,
                  { id: newElementId('f'), label: 'New field', type: 'text' },
                ],
              }))
            }
          >
            <PlusIcon className="size-5" />
            Add field
          </Button>
        ) : null}

        <h2 className="mt-8 mb-2.5 px-1 text-[13px] font-bold tracking-wide text-ink-500 uppercase">
          Universal QC Standards
        </h2>
        <SectionEditor
          section={draft.universalSection}
          index={0}
          total={1}
          readOnly={!isAdmin}
          open={openSection === draft.universalSection.id}
          onToggle={() =>
            setOpenSection((current) =>
              current === draft.universalSection.id ? null : draft.universalSection.id,
            )
          }
          onChange={(next) => setDraft((current) => ({ ...current, universalSection: next }))}
          onMove={() => undefined}
          onDelete={() => undefined}
        />

        {isAdmin ? (
          <Button variant="ghost" block className="mt-8" onClick={() => void handleReset()}>
            Reset shared sections to shipped versions
          </Button>
        ) : null}
      </Screen>

      {dirty && isAdmin ? (
        <div className="safe-pb fixed inset-x-0 bottom-0 z-30 border-t border-ink-200 bg-white/95 backdrop-blur no-print">
          <div className="mx-auto flex w-full max-w-3xl items-center gap-2 px-3 py-3">
            <Button variant="secondary" className="px-4" onClick={() => setDraft(shared)}>
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

function FieldEditor({
  field,
  index,
  total,
  readOnly,
  onChange,
  onMove,
  onDelete,
}: {
  field: FieldDef;
  index: number;
  total: number;
  readOnly?: boolean;
  onChange: (next: FieldDef) => void;
  onMove: (direction: -1 | 1) => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Card>
      <div className="flex items-center gap-2 p-3">
        {!readOnly ? (
          <div className="flex shrink-0 flex-col">
            <button
              type="button"
              disabled={index === 0}
              onClick={() => onMove(-1)}
              aria-label="Move field up"
              className="flex size-7 items-center justify-center rounded-t-lg border border-ink-200 text-ink-500 disabled:opacity-30 active:bg-ink-100"
            >
              <ChevronDownIcon className="size-4 rotate-180" />
            </button>
            <button
              type="button"
              disabled={index === total - 1}
              onClick={() => onMove(1)}
              aria-label="Move field down"
              className="-mt-px flex size-7 items-center justify-center rounded-b-lg border border-ink-200 text-ink-500 disabled:opacity-30 active:bg-ink-100"
            >
              <ChevronDownIcon className="size-4" />
            </button>
          </div>
        ) : null}
        <button
          type="button"
          onClick={() => setOpen((current) => !current)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
          aria-expanded={open}
        >
          <div className="min-w-0 flex-1">
            <p className="truncate text-[15px] font-semibold text-ink-900">
              {field.label || 'Untitled field'}
              {field.required ? <span className="ml-1 text-fail-600">*</span> : null}
            </p>
            <p className="text-xs text-ink-500">
              {FIELD_TYPES.find((type) => type.id === field.type)?.label ?? field.type}
              {field.fromJob ? ` · prefilled from job.${field.fromJob}` : ''}
            </p>
          </div>
          <ChevronDownIcon
            className={cx('size-5 shrink-0 text-ink-400 transition-transform', open && 'rotate-180')}
          />
        </button>
      </div>

      {open ? (
        <div className="flex flex-col gap-3 border-t border-ink-100 bg-ink-50 p-3">
          <Field label="Label" required>
            <TextInput
              value={field.label}
              disabled={readOnly}
              onChange={(event) => onChange({ ...field, label: event.target.value })}
            />
          </Field>

          <div>
            <span className="mb-1.5 block text-[13px] font-semibold text-ink-700">Type</span>
            <div className="flex flex-wrap gap-1.5">
              {FIELD_TYPES.map((type) => (
                <button
                  key={type.id}
                  type="button"
                  disabled={readOnly}
                  aria-pressed={field.type === type.id}
                  onClick={() => onChange({ ...field, type: type.id })}
                  className={cx(
                    'rounded-full px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-60',
                    field.type === type.id
                      ? 'bg-ink-900 text-white'
                      : 'border border-ink-200 bg-white text-ink-600',
                  )}
                >
                  {type.label}
                </button>
              ))}
            </div>
          </div>

          {field.type === 'select' ? (
            <Field label="Choices" hint="One per line.">
              <textarea
                rows={3}
                value={(field.options ?? []).join('\n')}
                disabled={readOnly}
                onChange={(event) =>
                  onChange({
                    ...field,
                    options: event.target.value.split('\n').map((line) => line.trim()).filter(Boolean),
                  })
                }
                className={inputClass}
              />
            </Field>
          ) : (
            <Field label="Placeholder">
              <TextInput
                value={field.placeholder ?? ''}
                disabled={readOnly}
                onChange={(event) => onChange({ ...field, placeholder: event.target.value })}
              />
            </Field>
          )}

          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              disabled={readOnly}
              aria-pressed={Boolean(field.required)}
              onClick={() => onChange({ ...field, required: !field.required })}
              className={cx(
                'rounded-full px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-60',
                field.required
                  ? 'bg-fail-100 text-fail-700'
                  : 'border border-ink-200 bg-white text-ink-500',
              )}
            >
              Required
            </button>
            <button
              type="button"
              disabled={readOnly}
              aria-pressed={Boolean(field.half)}
              onClick={() => onChange({ ...field, half: !field.half })}
              className={cx(
                'rounded-full px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-60',
                field.half
                  ? 'bg-ink-900 text-white'
                  : 'border border-ink-200 bg-white text-ink-500',
              )}
            >
              Half width
            </button>
          </div>

          {!readOnly ? (
            <button
              type="button"
              onClick={onDelete}
              className="flex items-center gap-1.5 text-xs font-semibold text-fail-600"
            >
              <TrashIcon className="size-3.5" />
              Remove field
            </button>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}
