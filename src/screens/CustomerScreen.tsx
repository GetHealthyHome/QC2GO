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
import { Badge, Button, Card, Screen, TopBar, cx } from '../components/ui';
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

  const [newDay, setNewDay] = useState(todayIso());
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

  async function start(templateId: string) {
    if (!customer || starting) return;
    setStarting(true);
    try {
      const inspection = await createInspection(customer.id, templateId, visitType, newDay);
      navigate(`/inspections/${inspection.id}`);
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

  const startedToday = new Set(
    inspections.filter((i) => i.visitDate === newDay).map((i) => i.templateId),
  );

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
            className="flex size-10 items-center justify-center rounded-xl text-white/80 active:bg-white/10"
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

        {/* Start work for a given day. */}
        <h2 className="mt-6 mb-2.5 px-1 text-[13px] font-bold tracking-wide text-ink-500 uppercase">
          Start a checklist
        </h2>
        <Card className="p-4">
          <div className="flex flex-col gap-3">
            <label className="block">
              <span className="mb-1.5 block text-[13px] font-semibold text-ink-700">
                Visit day
              </span>
              <input
                type="date"
                value={newDay}
                onChange={(event) => setNewDay(event.target.value || todayIso())}
                className="w-full rounded-xl border border-ink-200 bg-white px-3.5 py-3 text-ink-900 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
              />
            </label>
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
          </div>

          {selected.length === 0 ? (
            <p className="mt-3 rounded-xl bg-warn-50 p-3 text-[13px] text-warn-700">
              Tick at least one checklist above before starting.
            </p>
          ) : (
            <div className="mt-4 flex flex-col gap-2">
              {selected.map((template) => (
                <Button
                  key={template.id}
                  variant="secondary"
                  block
                  disabled={starting}
                  className="justify-between"
                  onClick={() => void start(template.id)}
                >
                  <span className="truncate text-left">{template.name}</span>
                  <span className="flex shrink-0 items-center gap-1.5 text-xs font-bold text-brand-700">
                    {startedToday.has(template.id) ? 'Run again' : 'Start'}
                    <PlusIcon className="size-4" />
                  </span>
                </Button>
              ))}
            </div>
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

        {/* QC cards, grouped by the day they cover. */}
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
