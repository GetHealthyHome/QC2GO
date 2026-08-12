import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useStore } from '../lib/store';
import { useAuth } from '../lib/auth';
import {
  TASK_LABELS,
  TASK_STATES,
  countByState,
  legalMoves,
  orderTasks,
  selfVerified,
  type TaskView,
} from '../lib/tasks';
import { formatDate, todayIso } from '../lib/inspection';
import type { TaskState } from '../lib/types';
import {
  AutoTextarea,
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Screen,
  TextInput,
  TopBar,
  cx,
} from '../components/ui';
import { AlertIcon, ChevronRightIcon, ClipboardIcon, PlusIcon, TrashIcon } from '../components/Icons';

/**
 * Every open piece of work in the company, in one place.
 *
 * The punch list answers "what is still open on this customer". This answers
 * the question a supervisor actually has, which is "who is doing it" — across
 * every customer, with the thing that holds a job at the top.
 *
 * Two kinds of row share the board. Most tasks correct a failed checkpoint and
 * link back to the punch item that raised them; the rest are standalone work
 * orders with no inspection behind them. They are not visually separated,
 * because to the person doing the work they are the same thing: something that
 * has to happen before this job is finished.
 */
export function TasksScreen() {
  const { tasks, customers, shared, createTask } = useStore();
  const [filter, setFilter] = useState<TaskState | 'open' | 'all'>('open');
  const [adding, setAdding] = useState(false);

  const today = todayIso();

  // Resolutions live per customer, and a linked task's state is read back out
  // of them — so the whole map has to be to hand before anything is ordered.
  const resolutions = useMemo(() => {
    const merged: Record<string, { at: string; by?: string; note?: string }> = {};
    for (const customer of customers) Object.assign(merged, customer.punchResolutions ?? {});
    return merged;
  }, [customers]);

  const views = useMemo(
    () => orderTasks(tasks, resolutions, today),
    [tasks, resolutions, today],
  );
  const counts = useMemo(() => countByState(views), [views]);

  const shown = views.filter((view) =>
    filter === 'all' ? true : filter === 'open' ? view.effective !== 'verified' : view.effective === filter,
  );

  const openCount = views.filter((view) => view.effective !== 'verified').length;

  return (
    <>
      <TopBar
        title="Work orders"
        subtitle={openCount === 0 ? 'Nothing outstanding' : `${openCount} open`}
        back="/"
        actions={
          <button
            type="button"
            onClick={() => setAdding((current) => !current)}
            aria-label="Add a work order"
            className="flex size-10 items-center justify-center rounded-xl text-white/80 active:bg-white/10"
          >
            <PlusIcon className="size-5" />
          </button>
        }
      />

      <Screen className="pb-10">
        {/*
          * Suggestions, not a closed list. A company that has not filled in the
          * roster yet would otherwise be unable to assign anybody — and since
          * nothing moves off New until it has a name on it, the whole board
          * would be frozen with nothing on screen explaining why.
          */}
        <datalist id="qc-assignees">
          {shared.teamLeaders.map((name) => (
            <option key={name} value={name} />
          ))}
        </datalist>

        {adding ? (
          <NewTaskForm
            customers={customers.filter((customer) => !customer.archived)}
            onCancel={() => setAdding(false)}
            onCreate={async (input) => {
              await createTask(input);
              setAdding(false);
              setFilter('open');
            }}
          />
        ) : null}

        <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 no-scrollbar">
          <FilterChip active={filter === 'open'} onClick={() => setFilter('open')}>
            Open ({openCount})
          </FilterChip>
          {TASK_STATES.map((state) => (
            <FilterChip key={state} active={filter === state} onClick={() => setFilter(state)}>
              {TASK_LABELS[state]} ({counts[state]})
            </FilterChip>
          ))}
          <FilterChip active={filter === 'all'} onClick={() => setFilter('all')}>
            All ({views.length})
          </FilterChip>
        </div>

        {shown.length === 0 ? (
          <EmptyState
            icon={<ClipboardIcon className="size-6" />}
            title={views.length === 0 ? 'No work orders yet' : 'Nothing here'}
            description={
              views.length === 0
                ? 'Raise one from a punch list to put somebody’s name on a deficiency, or add a standalone job with the + button.'
                : 'Nothing is in this state right now.'
            }
          />
        ) : (
          <div className="mt-3 flex flex-col gap-2">
            {shown.map((view) => (
              <TaskCard key={view.id} view={view} />
            ))}
          </div>
        )}
      </Screen>
    </>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-active={active || undefined}
      className={cx(
        'shrink-0 rounded-full px-3 py-1.5 text-[13px] font-semibold whitespace-nowrap',
        active ? 'bg-brand-600 text-white' : 'bg-ink-100 text-ink-600',
      )}
    >
      {children}
    </button>
  );
}

function TaskCard({ view }: { view: TaskView }) {
  const { customers, shared, moveTask, updateTask, removeTask } = useStore();
  const { profile } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [criteriaDraft, setCriteriaDraft] = useState<string | null>(null);
  const customer = customers.find((candidate) => candidate.id === view.customerId);
  const moves = legalMoves(
    { ...view, state: view.effective },
    { requireSecondVerifier: shared.requireSecondVerifier, actor: profile?.email },
  );

  async function move(to: TaskState) {
    setError(null);
    let note: string | undefined;
    // Two moves are worth interrupting somebody for: unsaying a verification,
    // and recording what was actually done to correct a deficiency.
    if (view.effective === 'verified') {
      const reason = window.prompt(
        'Reopening a verified task is recorded permanently. Why is it being reopened?',
      );
      if (reason === null) return;
      note = reason;
    } else if (to === 'verified') {
      // The standard first, then the question. Somebody re-checking a
      // correction they did not make has no other way to know what "good"
      // was supposed to look like here.
      const reason = window.prompt(
        view.verifyCriteria
          ? `Check: ${view.verifyCriteria}\n\nWhat did you find? (optional)`
          : 'What was done? (optional)',
      );
      if (reason === null) return;
      note = reason;
    }
    const decision = await moveTask(view.id, to, note);
    if (!decision.ok) setError(decision.reason);
  }

  return (
    <Card
      className={cx(
        'p-4',
        view.critical && view.effective !== 'verified' && 'border-fail-200 bg-fail-50/40',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold tracking-wide text-ink-400 uppercase">
            {customer?.customerName ?? 'Customer'}
            {view.punchKey ? ' · from a failed checkpoint' : ''}
          </p>
          <p className="mt-0.5 text-[14px] leading-snug font-semibold text-ink-900">{view.title}</p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <Badge tone={view.effective === 'verified' ? 'pass' : view.critical ? 'fail' : undefined}>
            {TASK_LABELS[view.effective]}
          </Badge>
          {view.due === 'overdue' ? <Badge tone="fail">Overdue</Badge> : null}
          {view.due === 'today' ? <Badge tone="warn">Due today</Badge> : null}
        </div>
      </div>

      {view.detail ? (
        <p className="mt-2 rounded-lg bg-ink-50 p-2.5 text-[13px] leading-relaxed text-ink-700">
          {view.detail}
        </p>
      ) : null}

      {/*
        * What the person re-checking is looking for. Seeded from the
        * checkpoint's own guidance where the checklist has any, and editable
        * because the standard for a particular correction is not always the
        * standard for the checkpoint in general.
        */}
      {criteriaDraft !== null ? (
        <div className="mt-2">
          <Field label="What to check before verifying">
            <AutoTextarea
              autoFocus
              value={criteriaDraft}
              placeholder="Two-part foam, full depth, no gaps at the sill plate."
              onChange={(event) => setCriteriaDraft(event.target.value)}
              onBlur={() => {
                void updateTask(view.id, { verifyCriteria: criteriaDraft.trim() || undefined });
                setCriteriaDraft(null);
              }}
            />
          </Field>
        </div>
      ) : view.verifyCriteria ? (
        <button
          type="button"
          onClick={() => setCriteriaDraft(view.verifyCriteria ?? '')}
          className="mt-2 block w-full rounded-lg bg-brand-50 p-2.5 text-left"
        >
          <span className="text-[11px] font-semibold tracking-wide text-brand-700 uppercase">
            Verify by
          </span>
          <span className="block text-[13px] leading-relaxed text-brand-800">
            {view.verifyCriteria}
          </span>
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setCriteriaDraft('')}
          className="mt-2 py-1 text-[13px] font-semibold text-brand-700"
        >
          Say what to check before verifying
        </button>
      )}

      <div className="mt-3 grid grid-cols-2 gap-2">
        <Field label="Assigned to">
          <TextInput
            list="qc-assignees"
            value={view.assignee ?? ''}
            placeholder="Nobody yet"
            onChange={(event) =>
              void updateTask(view.id, { assignee: event.target.value || undefined })
            }
          />
        </Field>
        <Field label="Due">
          <TextInput
            type="date"
            value={view.dueDate ?? ''}
            onChange={(event) => void updateTask(view.id, { dueDate: event.target.value || undefined })}
          />
        </Field>
      </div>

      {/*
        * Not blocked, and shown rather than hidden. A rule demanding a second
        * account would deadlock a two-person company, and a rule that cannot be
        * followed gets worked around instead of followed.
        */}
      {selfVerified(view) ? (
        <p className="mt-2 flex items-start gap-1.5 rounded-lg bg-warn-50 px-2.5 py-2 text-[12px] font-medium text-warn-700">
          <AlertIcon className="mt-0.5 size-3.5 shrink-0" />
          <span>The same account marked this done and then verified it.</span>
        </p>
      ) : null}

      {error ? (
        <p className="mt-2 flex items-start gap-1.5 rounded-lg bg-fail-50 px-2.5 py-2 text-[12px] font-medium text-fail-700">
          <AlertIcon className="mt-0.5 size-3.5 shrink-0" />
          <span>{error}</span>
        </p>
      ) : null}

      {moves.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {moves.map((state) => (
            <button
              key={state}
              type="button"
              onClick={() => void move(state)}
              className="rounded-full bg-ink-100 px-3 py-1.5 text-[13px] font-semibold text-ink-700 active:bg-ink-200"
            >
              {TASK_LABELS[state]}
            </button>
          ))}
        </div>
      ) : (
        <p className="mt-3 text-[12px] text-ink-500">Give this task to somebody to move it on.</p>
      )}

      <div className="mt-3 flex items-center justify-between gap-2">
        {view.inspectionId ? (
          <Link
            to={`/inspections/${view.inspectionId}/report`}
            className="py-1.5 text-[13px] font-semibold text-brand-700"
          >
            Open the inspection
          </Link>
        ) : customer ? (
          <Link
            to={`/customers/${customer.id}`}
            className="py-1.5 text-[13px] font-semibold text-brand-700"
          >
            Open the customer
          </Link>
        ) : (
          <span />
        )}
        <button
          type="button"
          onClick={() => {
            if (window.confirm('Remove this work order?')) void removeTask(view.id);
          }}
          aria-label="Remove this work order"
          className="flex size-9 items-center justify-center rounded-xl text-ink-400 active:bg-ink-100"
        >
          <TrashIcon className="size-4" />
        </button>
      </div>

      {view.history.length > 1 ? <History view={view} /> : null}
    </Card>
  );
}

/**
 * Who moved it, and when. Collapsed by default — it is the answer to a question
 * somebody asks occasionally and never while doing the work.
 */
function History({ view }: { view: TaskView }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="mt-2 flex w-full items-center justify-between py-1.5"
      >
        <span className="text-[12px] font-semibold text-ink-500">
          History ({view.history.length})
        </span>
        <ChevronRightIcon
          className={cx('size-4 text-ink-300 transition-transform', open && 'rotate-90')}
        />
      </button>
      {open ? (
        <ul className="flex flex-col gap-1.5 border-t border-ink-100 pt-2">
          {[...view.history].reverse().map((event, index) => (
            <li key={`${event.at}-${index}`} className="text-[12px] text-ink-600">
              <span className="font-semibold text-ink-800">{TASK_LABELS[event.to]}</span>
              {' · '}
              {formatDate(event.at)}
              {event.by ? ` · ${event.by}` : ''}
              {event.note ? <span className="block text-ink-500">{event.note}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
}

function NewTaskForm({
  customers,
  onCreate,
  onCancel,
}: {
  customers: { id: string; customerName: string }[];
  onCreate: (input: {
    customerId: string;
    title: string;
    detail?: string;
    state: 'new';
    assignee?: string;
    dueDate?: string;
  }) => Promise<void>;
  onCancel: () => void;
}) {
  const [customerId, setCustomerId] = useState(customers[0]?.id ?? '');
  const [title, setTitle] = useState('');
  const [assignee, setAssignee] = useState('');
  const [dueDate, setDueDate] = useState('');

  return (
    <Card className="mb-3 p-4">
      <h2 className="text-[15px] font-bold text-ink-900">New work order</h2>
      <p className="mt-0.5 text-[13px] text-ink-500">
        For work with no failed checkpoint behind it — order the part, book the crane, come back
        when the drywall is up.
      </p>
      <div className="mt-3 flex flex-col gap-3">
        <Field label="Customer">
          <select
            value={customerId}
            onChange={(event) => setCustomerId(event.target.value)}
            className="w-full rounded-xl border border-ink-200 bg-white px-3 py-2 text-[14px]"
          >
            {customers.map((customer) => (
              <option key={customer.id} value={customer.id}>
                {customer.customerName}
              </option>
            ))}
          </select>
        </Field>
        <Field label="What needs doing">
          <TextInput
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Return to fit the missing filter rack"
          />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Assigned to">
            <TextInput
              list="qc-assignees"
              value={assignee}
              placeholder="Nobody yet"
              onChange={(event) => setAssignee(event.target.value)}
            />
          </Field>
          <Field label="Due">
            <TextInput type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} />
          </Field>
        </div>
        <div className="flex gap-2">
          <Button
            block
            disabled={!title.trim() || !customerId}
            onClick={() =>
              void onCreate({
                customerId,
                title: title.trim(),
                state: 'new',
                assignee: assignee || undefined,
                dueDate: dueDate || undefined,
              })
            }
          >
            Add it
          </Button>
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </div>
    </Card>
  );
}
