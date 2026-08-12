import { blankQuestion, moveItem } from '../lib/checklist';
import type { Question, QuestionKind, Section } from '../lib/types';
import { AutoTextarea, Button, Card, Field, TextInput, cx } from '../components/ui';
import {
  AlertIcon,
  CameraIcon,
  ChevronDownIcon,
  PlusIcon,
  TrashIcon,
} from './Icons';

const KINDS: Array<{ id: QuestionKind; label: string; hint: string }> = [
  { id: 'yesno', label: 'Yes / No', hint: 'Pass, fail, or not applicable' },
  { id: 'measurement', label: 'Measurement', hint: 'A recorded number' },
  { id: 'text', label: 'Text', hint: 'A recorded note' },
];

/** Up/down arrows rather than drag handles — reliable with gloves and on small screens. */
function MoveButtons({
  index,
  total,
  onMove,
  label,
}: {
  index: number;
  total: number;
  onMove: (direction: -1 | 1) => void;
  label: string;
}) {
  return (
    <div className="flex shrink-0 flex-col">
      <button
        type="button"
        disabled={index === 0}
        onClick={() => onMove(-1)}
        aria-label={`Move ${label} up`}
        className="flex size-7 items-center justify-center rounded-t-lg border border-ink-200 text-ink-500 disabled:opacity-30 active:bg-ink-100"
      >
        <ChevronDownIcon className="size-4 rotate-180" />
      </button>
      <button
        type="button"
        disabled={index === total - 1}
        onClick={() => onMove(1)}
        aria-label={`Move ${label} down`}
        className="-mt-px flex size-7 items-center justify-center rounded-b-lg border border-ink-200 text-ink-500 disabled:opacity-30 active:bg-ink-100"
      >
        <ChevronDownIcon className="size-4" />
      </button>
    </div>
  );
}

export function SectionEditor({
  section,
  index,
  total,
  readOnly,
  open,
  onToggle,
  onChange,
  onMove,
  onDelete,
}: {
  section: Section;
  index: number;
  total: number;
  readOnly?: boolean;
  open: boolean;
  onToggle: () => void;
  onChange: (next: Section) => void;
  onMove: (direction: -1 | 1) => void;
  onDelete: () => void;
}) {
  function updateQuestion(questionIndex: number, question: Question) {
    onChange({
      ...section,
      questions: section.questions.map((q, i) => (i === questionIndex ? question : q)),
    });
  }

  return (
    <Card>
      <div className="flex items-center gap-2 p-3">
        {!readOnly ? (
          <MoveButtons index={index} total={total} onMove={onMove} label="section" />
        ) : null}
        <button
          type="button"
          onClick={onToggle}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
          aria-expanded={open}
        >
          <div className="min-w-0 flex-1">
            <p className="truncate text-[15px] font-bold text-ink-900">
              {section.title || 'Untitled section'}
            </p>
            <p className="text-xs text-ink-500">
              {section.questions.length} checkpoint{section.questions.length === 1 ? '' : 's'}
            </p>
          </div>
          <ChevronDownIcon
            className={cx('size-5 shrink-0 text-ink-400 transition-transform', open && 'rotate-180')}
          />
        </button>
      </div>

      {open ? (
        <div className="border-t border-ink-100 bg-ink-50 p-3">
          <div className="flex flex-col gap-3">
            <Field label="Section title" required>
              <TextInput
                value={section.title}
                disabled={readOnly}
                onChange={(event) => onChange({ ...section, title: event.target.value })}
              />
            </Field>
            <Field label="Description" hint="Optional guidance shown under the section heading.">
              <TextInput
                value={section.description ?? ''}
                disabled={readOnly}
                onChange={(event) => onChange({ ...section, description: event.target.value })}
              />
            </Field>

            {/*
              A repeatable section runs once per thing on the job rather than
              once per inspection. The inspector decides how many while standing
              in the building; the checklist only says that it repeats.
            */}
            <label className="flex items-start gap-2.5">
              <input
                type="checkbox"
                checked={section.repeatable === true}
                disabled={readOnly}
                onChange={(event) =>
                  onChange({
                    ...section,
                    repeatable: event.target.checked || undefined,
                    instanceNoun: event.target.checked ? (section.instanceNoun ?? 'Head') : undefined,
                  })
                }
                className="mt-0.5 size-5 shrink-0 rounded border-ink-300"
              />
              <span className="min-w-0">
                <span className="block text-[14px] font-semibold text-ink-900">
                  Runs once per item
                </span>
                <span className="block text-[13px] text-ink-500">
                  For per-head, per-zone or per-room checks. Each one is answered and scored
                  separately, so a failure names the one it belongs to.
                </span>
              </span>
            </label>

            {section.repeatable ? (
              <Field
                label="What is one of them called"
                hint='Shown as "Add another head". Singular.'
              >
                <TextInput
                  value={section.instanceNoun ?? ''}
                  disabled={readOnly}
                  placeholder="Head"
                  onChange={(event) =>
                    onChange({ ...section, instanceNoun: event.target.value || undefined })
                  }
                />
              </Field>
            ) : null}
          </div>

          <div className="mt-4 flex flex-col gap-2">
            {section.questions.map((question, questionIndex) => (
              <QuestionEditor
                key={question.id}
                question={question}
                index={questionIndex}
                total={section.questions.length}
                readOnly={readOnly}
                onChange={(next) => updateQuestion(questionIndex, next)}
                onMove={(direction) =>
                  onChange({
                    ...section,
                    questions: moveItem(section.questions, questionIndex, questionIndex + direction),
                  })
                }
                onDelete={() =>
                  onChange({
                    ...section,
                    questions: section.questions.filter((_, i) => i !== questionIndex),
                  })
                }
              />
            ))}
          </div>

          {!readOnly ? (
            <>
              <Button
                variant="secondary"
                block
                className="mt-3"
                onClick={() =>
                  onChange({ ...section, questions: [...section.questions, blankQuestion()] })
                }
              >
                <PlusIcon className="size-5" />
                Add checkpoint
              </Button>
              <button
                type="button"
                onClick={onDelete}
                className="mt-2 flex w-full items-center justify-center gap-2 py-2.5 text-[13px] font-semibold text-fail-600"
              >
                <TrashIcon className="size-4" />
                Delete section
              </button>
            </>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}

function QuestionEditor({
  question,
  index,
  total,
  readOnly,
  onChange,
  onMove,
  onDelete,
}: {
  question: Question;
  index: number;
  total: number;
  readOnly?: boolean;
  onChange: (next: Question) => void;
  onMove: (direction: -1 | 1) => void;
  onDelete: () => void;
}) {
  const kind = question.kind ?? 'yesno';

  return (
    <div className="rounded-xl border border-ink-200 bg-white p-3">
      <div className="flex items-start gap-2">
        {!readOnly ? (
          <MoveButtons index={index} total={total} onMove={onMove} label="checkpoint" />
        ) : null}
        <div className="min-w-0 flex-1">
          <AutoTextarea
            value={question.text}
            disabled={readOnly}
            placeholder="What is the inspector checking?"
            onChange={(event) => onChange({ ...question, text: event.target.value })}
            className="text-[15px]"
          />
          <TextInput
            className="mt-2 text-[13px]"
            value={question.help ?? ''}
            disabled={readOnly}
            placeholder="Optional guidance — what good looks like"
            onChange={(event) => onChange({ ...question, help: event.target.value })}
          />
        </div>
      </div>

      <div className="mt-2.5 flex flex-wrap gap-1.5">
        {KINDS.map((option) => (
          <button
            key={option.id}
            type="button"
            disabled={readOnly}
            aria-pressed={kind === option.id}
            title={option.hint}
            onClick={() => onChange({ ...question, kind: option.id })}
            className={cx(
              'rounded-full px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-60',
              kind === option.id
                ? 'bg-ink-900 text-white'
                : 'border border-ink-200 bg-white text-ink-600',
            )}
          >
            {option.label}
          </button>
        ))}
      </div>

      {kind === 'measurement' ? (
        <TextInput
          className="mt-2 text-[13px]"
          value={question.unit ?? ''}
          disabled={readOnly}
          placeholder="Unit — e.g. CFM50, microns, in. w.c., °F"
          onChange={(event) => onChange({ ...question, unit: event.target.value })}
        />
      ) : (
        <div className="mt-2 flex flex-wrap gap-1.5">
          <Toggle
            active={Boolean(question.critical)}
            disabled={readOnly}
            icon={<AlertIcon className="size-3.5" />}
            label="Critical"
            tone="warn"
            onClick={() => onChange({ ...question, critical: !question.critical })}
          />
          <Toggle
            active={Boolean(question.photoOnPass)}
            disabled={readOnly}
            icon={<CameraIcon className="size-3.5" />}
            label="Photo for record"
            tone="brand"
            onClick={() => onChange({ ...question, photoOnPass: !question.photoOnPass })}
          />
        </div>
      )}

      {!readOnly ? (
        <button
          type="button"
          onClick={onDelete}
          className="mt-2 flex items-center gap-1.5 text-xs font-semibold text-fail-600"
        >
          <TrashIcon className="size-3.5" />
          Remove
        </button>
      ) : null}
    </div>
  );
}

function Toggle({
  active,
  disabled,
  icon,
  label,
  tone,
  onClick,
}: {
  active: boolean;
  disabled?: boolean;
  icon: React.ReactNode;
  label: string;
  tone: 'warn' | 'brand';
  onClick: () => void;
}) {
  const activeClass = tone === 'warn' ? 'bg-warn-100 text-warn-700' : 'bg-brand-100 text-brand-800';
  return (
    <button
      type="button"
      disabled={disabled}
      aria-pressed={active}
      onClick={onClick}
      className={cx(
        'inline-flex items-center gap-1 rounded-full px-2.5 py-1.5 text-xs font-semibold transition-colors disabled:opacity-60',
        active ? activeClass : 'border border-ink-200 bg-white text-ink-500',
      )}
    >
      {icon}
      {label}
    </button>
  );
}
