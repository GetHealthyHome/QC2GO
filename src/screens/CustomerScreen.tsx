import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useCustomer, useCustomerInspections, useStore } from '../lib/store';
import { questionCount } from '../lib/checklist';
import { punchListFor } from '../lib/punch';
import {
  VISIT_TYPE_LABELS,
  formatDate,
  groupByVisitDate,
  todayIso,
} from '../lib/inspection';
import { categoryLabel } from '../templates';
import type { Template, VisitType } from '../lib/types';
import { QCCard } from '../components/QCCard';
import { Badge, Button, Card, Screen, TopBar, cx, topBarActionClass } from '../components/ui';
import {
  AlertIcon,
  CheckIcon,
  ChevronRightIcon,
  MapPinIcon,
  PenIcon,
  PlusIcon,
  TrashIcon,
} from '../components/Icons';

const VISIT_TYPES: VisitType[] = ['site-visit', 'final-walkthrough', 'punch-recheck'];

export function CustomerScreen() {
  const { customerId } = useParams();
  const navigate = useNavigate();
  const customer = useCustomer(customerId);
  const inspections = useCustomerInspections(customerId);
  const { templates, shared, updateCustomer, removeCustomer, createInspection } = useStore();

  const [visitType, setVisitType] = useState<VisitType>('site-visit');
  const [starting, setStarting] = useState(false);

  const available = useMemo(
    () => templates.filter((template) => !template.archived),
    [templates],
  );
  const selected = useMemo(
    () => available.filter((template) => customer?.templateIds?.includes(template.id)),
    [available, customer?.templateIds],
  );
  const days = useMemo(() => groupByVisitDate(inspections), [inspections]);

  const today = todayIso();
  /**
   * The ticked checklists today has not finished with — what one press acts on.
   *
   * A checklist with a run still open counts as pending even if an earlier run
   * of it was completed today: the open one is the work in front of somebody.
   */
  const pending = useMemo(() => {
    const finished = new Set<string>();
    const running = new Set<string>();
    for (const inspection of inspections) {
      if (inspection.visitDate !== today) continue;
      (inspection.status === 'completed' ? finished : running).add(inspection.templateId);
    }
    return selected.filter(
      (template) => running.has(template.id) || !finished.has(template.id),
    );
  }, [selected, inspections, today]);
  const punch = useMemo(
    () => punchListFor(customer, inspections, templates, shared),
    [customer, inspections, templates, shared],
  );

  if (!customer) {
    return (
      <>
        <TopBar title="Customer not found" back="/" />
        <Screen>
          <p className="text-sm text-ink-500">That customer is no longer on this device.</p>
        </Screen>
      </>
    );
  }

  function toggleTemplate(templateId: string) {
    if (!customer) return;
    const current = customer.templateIds ?? [];
    const next = current.includes(templateId)
      ? current.filter((id) => id !== templateId)
      : [...current, templateId];
    void updateCustomer(customer.id, { templateIds: next });
  }

  /**
   * Begin the walkthrough for everything this job is ticked for.
   *
   * One press rather than one per checklist, and no date to choose: a
   * walkthrough happens on the day somebody is standing in the house, so the
   * day is today and asking was a field between the inspector and the work.
   *
   * What one press does depends on what today already holds, because the same
   * button has to survive being pressed again — which is what somebody does
   * every time they come back to their phone:
   *
   *  - not started today  ->  started
   *  - under way today    ->  resumed, never duplicated
   *  - finished today     ->  left alone; its QC card is at the top of the page
   *
   * When every ticked checklist is finished the button says so and offers the
   * only thing left to want — a fresh run of all of them. That is the old
   * "Run again", kept rather than lost to the simpler button.
   *
   * It navigates to what this press *started*, falling back to what it resumed.
   * Pressing it to add one checklist to a day should open that checklist, not
   * drop you back into something you already had open.
   */
  async function startWalkthrough() {
    if (!customer || starting || selected.length === 0) return;
    setStarting(true);
    try {
      const again = pending.length === 0;
      const targets = again ? selected : pending;
      const openToday = new Map(
        inspections
          .filter((i) => i.visitDate === today && i.status !== 'completed')
          .map((i) => [i.templateId, i]),
      );

      let created: string | undefined;
      let resumed: string | undefined;
      for (const template of targets) {
        // A deliberate re-run starts fresh even where something is open.
        const running = again ? undefined : openToday.get(template.id);
        if (running) {
          resumed ??= running.id;
          continue;
        }
        const made = await createInspection(customer.id, template.id, visitType);
        created ??= made.id;
      }

      const go = created ?? resumed;
      if (go) navigate(`/inspections/${go}`);
    } finally {
      setStarting(false);
    }
  }

  async function handleDelete() {
    if (!customer) return;
    const confirmed = window.confirm(
      `Delete ${customer.customerName} and all ${inspections.length} inspection(s) with their photos? This cannot be undone.`,
    );
    if (!confirmed) return;
    await removeCustomer(customer.id);
    navigate('/', { replace: true });
  }

  const runningToday = inspections.filter(
    (i) => i.visitDate === today && i.status !== 'completed',
  ).length;

  const details: Array<[string, string | undefined]> = [
    ['Address', customer.address],
    ['Phone', customer.phone],
    ['Salesperson', customer.salesperson],
    ['Team leader', customer.teamLeader],
    ['Job #', customer.jobNumber],
  ];

  return (
    <>
      <TopBar
        title={customer.customerName}
        subtitle={customer.address || undefined}
        back="/"
        actions={
          <Link
            to={`/customers/${customer.id}/edit`}
            aria-label="Edit customer"
            className={topBarActionClass}
          >
            <PenIcon className="size-5" />
          </Link>
        }
      />

      <Screen className="pb-10">
        {/* The white box: everything about this customer at a glance. */}
        <Card className="p-4">
          <h2 className="text-lg leading-tight font-bold text-ink-900">{customer.customerName}</h2>
          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3">
            {details.map(([label, value]) =>
              value ? (
                <div key={label} className={label === 'Address' ? 'col-span-2' : undefined}>
                  <dt className="text-[11px] font-semibold tracking-wide text-ink-400 uppercase">
                    {label}
                  </dt>
                  <dd className="text-[15px] font-medium text-ink-900">{value}</dd>
                </div>
              ) : null,
            )}
          </dl>
          {customer.workScope ? (
            <div className="mt-3">
              <p className="text-[11px] font-semibold tracking-wide text-ink-400 uppercase">
                Work Scope / Job Notes
              </p>
              <p className="mt-1 rounded-xl bg-ink-50 p-3 text-[13px] leading-relaxed whitespace-pre-wrap text-ink-700">
                {customer.workScope}
              </p>
            </div>
          ) : null}
          {customer.location ? (
            <p className="mt-3 flex items-center gap-1.5 text-xs font-medium text-pass-700">
              <MapPinIcon className="size-3.5" />
              Location saved — appears under Near me
            </p>
          ) : null}
        </Card>

        {/*
          QC cards, directly under the customer box.
          What happened on this job is the thing somebody opens this screen to
          find. It used to be last, below the checklist tick-list and the punch
          list, which meant scrolling past the setup for the job to reach the
          record of it.
        */}
        <h2 className="mt-6 mb-2.5 px-1 text-[13px] font-bold tracking-wide text-ink-500 uppercase">
          QC Cards
        </h2>
        {days.length === 0 ? (
          <Card className="p-4">
            <p className="text-[13px] text-ink-500">
              Completed checklists appear here as QC cards, grouped by the day they cover.
            </p>
          </Card>
        ) : (
          <div className="flex flex-col gap-5">
            {days.map(([day, dayInspections]) => (
              <div key={day}>
                <div className="mb-2 flex items-baseline justify-between px-1">
                  <h3 className="text-[15px] font-bold text-ink-900">{formatDate(day)}</h3>
                  <span className="text-xs text-ink-500">
                    {dayInspections.length} checklist{dayInspections.length === 1 ? '' : 's'}
                  </span>
                </div>
                <div className="flex flex-col gap-2">
                  {dayInspections.map((inspection) => (
                    <QCCard key={inspection.id} inspection={inspection} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Checkboxes: which QC areas apply to this job. */}
        <h2 className="mt-6 mb-2 px-1 text-[13px] font-bold tracking-wide text-ink-500 uppercase">
          Checklists for this job
        </h2>
        <p className="mb-2.5 px-1 text-[13px] text-ink-500">
          Tick every area of quality control this job needs. Ticked checklists become available
          to run on any visit day.
        </p>
        <ul className="flex flex-col gap-2">
          {available.map((template) => (
            <TemplateCheckbox
              key={template.id}
              template={template}
              checked={customer.templateIds?.includes(template.id) ?? false}
              count={questionCount(template, shared)}
              onToggle={() => toggleTemplate(template.id)}
            />
          ))}
        </ul>

        {/*
          One button, once there is something to run.
          The day is today — a walkthrough happens while somebody is standing in
          the house — so the only thing left to say is which kind of visit it is.
        */}
        <Card className="mt-3 p-4">
          <div>
            <span className="mb-1.5 block text-[13px] font-semibold text-ink-700">
              Visit type
            </span>
            <div className="flex flex-wrap gap-1.5">
              {VISIT_TYPES.map((type) => (
                <button
                  key={type}
                  type="button"
                  aria-pressed={visitType === type}
                  onClick={() => setVisitType(type)}
                  className={cx(
                    'rounded-full px-3 py-2 text-xs font-semibold transition-colors',
                    visitType === type
                      ? 'bg-ink-900 text-white'
                      : 'border border-ink-200 bg-white text-ink-600',
                  )}
                >
                  {VISIT_TYPE_LABELS[type]}
                </button>
              ))}
            </div>
          </div>

          {selected.length === 0 ? (
            <p className="mt-3 rounded-xl bg-warn-50 p-3 text-[13px] text-warn-700">
              Tick at least one checklist above before starting.
            </p>
          ) : (
            <>
              <Button
                block
                className="mt-4"
                disabled={starting}
                onClick={() => void startWalkthrough()}
              >
                <PlusIcon className="size-5" />
                {starting
                  ? 'Starting…'
                  : pending.length === 0
                    ? 'Run QC Walkthrough again'
                    : 'Start QC Walkthrough'}
              </Button>
              <p className="mt-2 text-center text-xs text-ink-500">
                {pending.length === 0
                  ? `All ${selected.length} finished today`
                  : `${pending.length} checklist${pending.length === 1 ? '' : 's'} · today${
                      runningToday > 0 ? ` · ${runningToday} under way` : ''
                    }`}
              </p>
            </>
          )}
        </Card>

        {/*
          The punch list. Shown whenever there is anything on it at all: an
          inspector arriving for a return visit is asking "what am I here to
          re-check?", and that question should be answered before they have to
          go looking through past inspections for it.
        */}
        {punch.open.length > 0 || punch.resolved.length > 0 ? (
          <>
            <h2 className="mt-6 mb-2.5 px-1 text-[13px] font-bold tracking-wide text-ink-500 uppercase">
              Punch list
            </h2>
            <Card className="active:bg-ink-50">
              <Link to={`/customers/${customer.id}/punch`} className="flex items-center gap-3 p-4">
                <AlertIcon
                  className={cx(
                    'size-5 shrink-0',
                    punch.open.length > 0 ? 'text-fail-500' : 'text-pass-500',
                  )}
                />
                <div className="min-w-0 flex-1">
                  <p className="text-[15px] font-semibold text-ink-900">
                    {punch.open.length > 0
                      ? `${punch.open.length} item${punch.open.length === 1 ? '' : 's'} still open`
                      : 'Everything corrected'}
                  </p>
                  <p className="text-xs text-ink-500">
                    {punch.criticalOpen > 0
                      ? `${punch.criticalOpen} critical · `
                      : ''}
                    {punch.resolved.length} corrected across {inspections.length} checklist
                    {inspections.length === 1 ? '' : 's'}
                  </p>
                </div>
                {punch.criticalOpen > 0 ? <Badge tone="fail">Critical</Badge> : null}
                <ChevronRightIcon className="size-5 shrink-0 text-ink-300" />
              </Link>
            </Card>
          </>
        ) : null}

        <button
          type="button"
          onClick={() => void handleDelete()}
          className="mt-8 flex w-full items-center justify-center gap-2 py-3 text-[13px] font-semibold text-fail-600 active:text-fail-700 no-print"
        >
          <TrashIcon className="size-4" />
          Delete customer and all inspections
        </button>
      </Screen>
    </>
  );
}

function TemplateCheckbox({
  template,
  checked,
  count,
  onToggle,
}: {
  template: Template;
  checked: boolean;
  count: number;
  onToggle: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        role="checkbox"
        aria-checked={checked}
        onClick={onToggle}
        className={cx(
          'flex w-full items-center gap-3 rounded-2xl border-2 p-3.5 text-left transition-colors',
          checked ? 'border-brand-600 bg-brand-50' : 'border-ink-200 bg-white active:bg-ink-50',
        )}
      >
        <span
          className={cx(
            'flex size-6 shrink-0 items-center justify-center rounded-md border-2',
            checked ? 'border-brand-600 bg-brand-600 text-white' : 'border-ink-300 bg-white',
          )}
        >
          {checked ? <CheckIcon className="size-4" strokeWidth={4} /> : null}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-1.5">
            <Badge tone={checked ? 'brand' : 'neutral'}>{categoryLabel(template.category)}</Badge>
          </span>
          <span
            className={cx(
              'mt-1 block text-[15px] leading-tight font-bold',
              checked ? 'text-brand-800' : 'text-ink-900',
            )}
          >
            {template.name}
          </span>
          <span className="mt-0.5 block text-xs text-ink-500">{count} checkpoints</span>
        </span>
      </button>
    </li>
  );
}
