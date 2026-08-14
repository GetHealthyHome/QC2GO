import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate, useParams, useSearchParams } from 'react-router-dom';
import { useChecklist, useCustomer, useInspection, useStore } from '../lib/store';
import { refreshPosition } from '../lib/geo';
import {
  VISIT_TYPE_LABELS,
  conditionMet,
  expandSections,
  formatDate,
  getResponse,
  instanceTitle,
  instancesOf,
  newInstanceId,
  overallProgress,
  responseKey,
  sectionProgress,
  visibleQuestions,
} from '../lib/inspection';
import type { FieldDef, Inspection, Response, Section } from '../lib/types';
import { QuestionCard } from '../components/QuestionCard';
import { PhotoViewer } from '../components/Photos';
import {
  Badge,
  Button,
  EmptyState,
  Field,
  ProgressBar,
  Screen,
  TextInput,
  TopBar,
  cx,
  inputClass,
} from '../components/ui';
import {
  AlertIcon,
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  PlusIcon,
} from '../components/Icons';

const INFO_STEP = 'job-info';

export function InspectionScreen() {
  // Ask for a fix as the inspection opens, so the first photo of the visit has
  // one to stamp rather than being the one that goes without. Fire and forget —
  // nothing here waits on it, and a refusal is an ordinary outcome.
  useEffect(() => refreshPosition(), []);

  const { inspectionId } = useParams();
  const inspection = useInspection(inspectionId);
  const customer = useCustomer(inspection?.customerId);
  const { updateInspection, removePhoto } = useStore();
  const [searchParams, setSearchParams] = useSearchParams();
  const [viewingPhoto, setViewingPhoto] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const checklist = useChecklist(inspection);
  const sections = useMemo(() => checklist?.sections ?? [], [checklist]);

  // Steps are the expanded view: a repeatable section contributes one step per
  // instance, plus a step of its own for adding the first one.
  const rendered = useMemo(
    () => (inspection ? expandSections(inspection, sections) : []),
    [inspection, sections],
  );

  const steps = useMemo(() => {
    const list: Array<{ id: string; title: string; section?: Section; instanceId?: string }> = [
      { id: INFO_STEP, title: 'Job Information' },
    ];
    for (const section of sections) {
      const blocks = rendered.filter((entry) => entry.section.id === section.id);

      if (!section.repeatable) {
        // Absent from the expanded view means the section does not apply to this
        // job, so it gets no step at all — the whole point of the condition that
        // hid it. The block's section is used rather than the raw one because
        // its questions have already had the same rule applied.
        if (blocks.length === 0) continue;
        list.push({ id: section.id, title: section.title, section: blocks[0].section });
        continue;
      }

      if (blocks.length === 0) {
        // Either nobody has added an instance yet, or the section does not apply
        // at all. Only the first deserves a step saying so.
        if (!inspection || !conditionMet(inspection, section.showIf)) continue;
        list.push({ id: section.id, title: section.title, section });
        continue;
      }
      for (const block of blocks) {
        list.push({
          id: block.key,
          title: block.title.split(' — ').slice(1).join(' — ') || block.title,
          section: block.section,
          instanceId: block.instanceId,
        });
      }
    }
    return list;
  }, [inspection, sections, rendered]);

  const stepParam = searchParams.get('step');
  const focusQuestion = searchParams.get('focus');
  const stepIndex = Math.max(
    0,
    steps.findIndex((step) => step.id === stepParam),
  );
  const currentStep = steps[stepIndex] ?? steps[0];
  const currentSection = currentStep?.section;
  const currentInstanceId = currentStep?.instanceId;

  // Jump to the top on step change, and to a specific question when deep-linked.
  useEffect(() => {
    if (focusQuestion) {
      const node = document.getElementById(`q-${focusQuestion}`);
      if (node) {
        node.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }
    }
    window.scrollTo({ top: 0 });
  }, [stepIndex, focusQuestion]);

  // Keep the active section chip visible in the rail.
  useEffect(() => {
    const rail = scrollRef.current;
    const active = rail?.querySelector('[data-active="true"]');
    active?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  }, [stepIndex]);

  if (!inspection || !checklist) {
    return (
      <>
        <TopBar title="Inspection not found" back="/" />
        <Screen>
          <p className="text-sm text-ink-500">That inspection is no longer on this device.</p>
        </Screen>
      </>
    );
  }

  // A signed-off inspection is read-only: send it to the report instead.
  if (inspection.status === 'completed') {
    return <Navigate to={`/inspections/${inspection.id}/report`} replace />;
  }

  const progress = overallProgress(inspection, sections);

  function goToStep(id: string) {
    setSearchParams({ step: id }, { replace: true });
  }

  function handleResponseChange(questionId: string, patch: Partial<Response>) {
    if (!inspection) return;
    const key = responseKey(questionId, currentInstanceId);
    const previous = getResponse(inspection, questionId, currentInstanceId);
    const next: Response = { ...previous, ...patch };

    // Dropping a photo from a response also drops the underlying blob.
    if (patch.photoIds) {
      const removed = previous.photoIds.filter((id) => !patch.photoIds!.includes(id));
      removed.forEach((id) => void removePhoto(id));
      return;
    }

    updateInspection(inspection.id, {
      responses: { ...inspection.responses, [key]: next },
    });
  }

  function addInstance(section: Section) {
    if (!inspection) return;
    const noun = section.instanceNoun?.trim() || 'Item';
    const existing = instancesOf(inspection, section);
    const label = window.prompt(
      `Name this ${noun.toLowerCase()} — where is it?`,
      `${noun} ${existing.length + 1}`,
    );
    if (label === null) return;

    const instance = { id: newInstanceId(), label: label.trim() || undefined };
    updateInspection(inspection.id, {
      sectionInstances: {
        ...(inspection.sectionInstances ?? {}),
        [section.id]: [...existing, instance],
      },
    });
    goToStep(`${section.id}#${instance.id}`);
  }

  function removeInstance(section: Section, instanceId: string) {
    if (!inspection) return;
    const existing = instancesOf(inspection, section);
    const instance = existing.find((entry) => entry.id === instanceId);
    const position = existing.findIndex((entry) => entry.id === instanceId) + 1;
    const name = instance ? instanceTitle(section, instance, position) : 'this one';
    if (!window.confirm(`Remove ${name} and everything answered on it?`)) return;

    // The answers go with it. Leaving them behind would keep scoring a thing
    // that is no longer part of the inspection.
    const responses = { ...inspection.responses };
    for (const question of section.questions) {
      const key = responseKey(question.id, instanceId);
      for (const photoId of responses[key]?.photoIds ?? []) void removePhoto(photoId);
      delete responses[key];
    }

    updateInspection(inspection.id, {
      responses,
      sectionInstances: {
        ...(inspection.sectionInstances ?? {}),
        [section.id]: existing.filter((entry) => entry.id !== instanceId),
      },
    });
    goToStep(section.id);
  }

  function handleInfoChange(fieldId: string, value: string) {
    if (!inspection) return;
    updateInspection(inspection.id, { info: { ...inspection.info, [fieldId]: value } });
  }

  const isLastStep = stepIndex === steps.length - 1;

  return (
    <>
      {/* Title and progress scroll as one block so neither can hide the other. */}
      <div className="sticky top-0 z-30 no-print">
        <TopBar
          sticky={false}
          title={customer?.customerName ?? 'Inspection'}
          subtitle={`${VISIT_TYPE_LABELS[inspection.visitType]} · ${checklist.templateName}`}
          back={customer ? `/customers/${customer.id}` : '/'}
        />
        <div className="border-b border-ink-200 bg-white/95 backdrop-blur">
          <div className="mx-auto w-full max-w-3xl px-3 pt-2.5">
          {/* Wraps as whole items: badges drop to a second line rather than
              "3 of 53 answered" breaking across one. */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-semibold text-ink-500">
            {/*
              The day this run covers, at the top of the checklist it belongs to.
              A checklist gets run against the same job more than once — a site
              visit, then a re-check — and each run carries its own date from the
              moment it is started. Without it on the page, two runs of the same
              checklist are indistinguishable while you are standing in one.
            */}
            <span className="shrink-0 rounded-md bg-ink-100 px-2 py-0.5 text-ink-700 tabular-nums">
              {formatDate(inspection.visitDate)}
            </span>
            <span className="ml-auto whitespace-nowrap tabular-nums">
              {progress.answered} of {progress.total} answered
            </span>
            <span className="flex items-center gap-1.5">
              {progress.failed > 0 ? (
                <Badge tone="fail">
                  <AlertIcon className="size-3" />
                  {progress.failed}
                </Badge>
              ) : null}
              {progress.incomplete > 0 ? (
                <Badge tone="warn">{progress.incomplete} need evidence</Badge>
              ) : null}
            </span>
          </div>
          <ProgressBar className="mt-1.5" value={progress.answered} total={progress.total} />
          <div ref={scrollRef} className="mt-2 flex gap-1.5 overflow-x-auto pb-2 no-scrollbar">
            {steps.map((step, index) => {
              const section = step.section;
              const stats =
                section && (!section.repeatable || step.instanceId)
                  ? sectionProgress(inspection, section, step.instanceId)
                  : null;
              const complete = stats ? stats.answered === stats.total && stats.total > 0 : false;
              return (
                <button
                  key={step.id}
                  type="button"
                  data-active={index === stepIndex}
                  onClick={() => goToStep(step.id)}
                  className={cx(
                    'flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors',
                    index === stepIndex
                      ? 'bg-ink-900 text-white'
                      : 'border border-ink-200 bg-white text-ink-600',
                  )}
                >
                  {complete ? (
                    <CheckIcon
                      className={cx(
                        'size-3.5',
                        index === stepIndex ? 'text-pass-100' : 'text-pass-600',
                      )}
                      strokeWidth={3}
                    />
                  ) : null}
                  {stats && stats.failed > 0 ? (
                    <span className="size-1.5 rounded-full bg-fail-500" />
                  ) : null}
                  {step.title}
                </button>
              );
            })}
            </div>
          </div>
        </div>
      </div>

      <Screen className="pb-32">
        {currentStep?.id === INFO_STEP ? (
          <JobInfoStep
            inspection={inspection}
            fields={checklist.infoFields}
            onChange={handleInfoChange}
          />
        ) : currentSection ? (
          <SectionStep
            section={currentSection}
            instanceId={currentInstanceId}
            inspection={inspection}
            focusQuestion={focusQuestion}
            onChange={handleResponseChange}
            onOpenPhoto={setViewingPhoto}
            onAddInstance={() => addInstance(currentSection)}
            onRemoveInstance={
              currentInstanceId
                ? () => removeInstance(currentSection, currentInstanceId)
                : undefined
            }
          />
        ) : null}
      </Screen>

      <div className="safe-pb fixed inset-x-0 bottom-0 z-30 border-t border-ink-200 bg-white/95 backdrop-blur no-print">
        <div className="mx-auto flex w-full max-w-3xl items-center gap-2 px-3 py-3">
          <Button
            variant="secondary"
            className="px-3"
            disabled={stepIndex === 0}
            onClick={() => goToStep(steps[stepIndex - 1].id)}
            aria-label="Previous section"
          >
            <ChevronLeftIcon className="size-5" />
          </Button>
          {isLastStep ? (
            <Link to={`/inspections/${inspection.id}/review`} className="flex-1">
              <Button block>Review &amp; sign</Button>
            </Link>
          ) : (
            <Button className="flex-1" onClick={() => goToStep(steps[stepIndex + 1].id)}>
              Next: {steps[stepIndex + 1].title}
              <ChevronRightIcon className="size-5" />
            </Button>
          )}
        </div>
      </div>

      {viewingPhoto ? (
        <PhotoViewer photoId={viewingPhoto} onClose={() => setViewingPhoto(null)} editable />
      ) : null}
    </>
  );
}

function JobInfoStep({
  inspection,
  fields,
  onChange,
}: {
  inspection: Inspection;
  fields: FieldDef[];
  onChange: (fieldId: string, value: string) => void;
}) {
  return (
    <>
      <SectionHeading
        title="Job Information"
        description="Captured on every inspection. Prefilled from the job record — confirm before you walk."
      />
      <div className="grid grid-cols-2 gap-3">
        {fields.map((field) => {
          const value = inspection.info[field.id] ?? '';
          const invalid = field.required && !value.trim();
          return (
            <Field
              key={field.id}
              label={field.label}
              required={field.required}
              className={field.half ? 'col-span-1' : 'col-span-2'}
              error={invalid ? 'Required' : undefined}
            >
              {field.type === 'select' ? (
                <select
                  value={value}
                  onChange={(event) => onChange(field.id, event.target.value)}
                  className={cx(inputClass, 'appearance-none')}
                >
                  <option value="">Select…</option>
                  {field.options?.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              ) : field.type === 'textarea' ? (
                <textarea
                  rows={3}
                  value={value}
                  onChange={(event) => onChange(field.id, event.target.value)}
                  className={inputClass}
                />
              ) : (
                <TextInput
                  type={field.type === 'number' ? 'text' : field.type}
                  inputMode={field.type === 'number' ? 'decimal' : undefined}
                  value={value}
                  placeholder={field.placeholder}
                  onChange={(event) => onChange(field.id, event.target.value)}
                />
              )}
            </Field>
          );
        })}
      </div>
    </>
  );
}

function SectionStep({
  section,
  instanceId,
  inspection,
  focusQuestion,
  onChange,
  onOpenPhoto,
  onAddInstance,
  onRemoveInstance,
}: {
  section: Section;
  instanceId?: string;
  inspection: Inspection;
  focusQuestion: string | null;
  onChange: (questionId: string, patch: Partial<Response>) => void;
  onOpenPhoto: (photoId: string) => void;
  onAddInstance: () => void;
  onRemoveInstance?: () => void;
}) {
  const noun = section.instanceNoun?.trim() || 'Item';
  const instances = instancesOf(inspection, section);

  // A repeatable section nobody has added anything to yet. Not an error — the
  // inspector has not got to it, or the job does not have any.
  if (section.repeatable && !instanceId) {
    return (
      <>
        <SectionHeading title={section.title} description={section.description} />
        <EmptyState
          icon={<PlusIcon className="size-6" />}
          title={`No ${noun.toLowerCase()} added yet`}
          description={`This section runs once per ${noun.toLowerCase()}. Add one for each on this job — they are scored separately, so a failure names the ${noun.toLowerCase()} it belongs to.`}
          action={
            <Button onClick={onAddInstance}>
              <PlusIcon className="size-4" />
              Add {noun.toLowerCase()}
            </Button>
          }
        />
      </>
    );
  }

  const stats = sectionProgress(inspection, section, instanceId);
  const position = instances.findIndex((entry) => entry.id === instanceId) + 1;
  const instance = instances.find((entry) => entry.id === instanceId);

  return (
    <>
      <SectionHeading
        title={
          instance ? instanceTitle(section, instance, position) : section.title
        }
        description={instance ? section.title : section.description}
        meta={`${stats.answered} of ${stats.total} answered`}
      />
      <div className="flex flex-col gap-2.5">
        {/* Filtered again here, so it cannot matter whether the step handed over
            a section that had the rule applied or a raw one. */}
        {visibleQuestions(inspection, section, instanceId).map((question, index) => (
          <QuestionCard
            key={question.id}
            index={index + 1}
            question={question}
            instanceId={instanceId}
            inspection={inspection}
            highlight={focusQuestion === question.id}
            onChange={onChange}
            onOpenPhoto={onOpenPhoto}
          />
        ))}
      </div>

      {section.repeatable ? (
        <div className="mt-4 flex flex-col gap-2">
          <Button variant="secondary" block onClick={onAddInstance}>
            <PlusIcon className="size-4" />
            Add another {noun.toLowerCase()}
          </Button>
          {onRemoveInstance ? (
            <button
              type="button"
              onClick={onRemoveInstance}
              className="py-2 text-center text-[13px] font-semibold text-fail-600"
            >
              Remove this {noun.toLowerCase()}
            </button>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

function SectionHeading({
  title,
  description,
  meta,
}: {
  title: string;
  description?: string;
  meta?: string;
}) {
  return (
    <div className="mb-3.5 px-1">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-xl leading-tight font-bold text-ink-900">{title}</h2>
        {meta ? (
          <span className="shrink-0 text-xs font-semibold text-ink-500 tabular-nums">{meta}</span>
        ) : null}
      </div>
      {description ? <p className="mt-1 text-[13px] text-ink-500">{description}</p> : null}
    </div>
  );
}
