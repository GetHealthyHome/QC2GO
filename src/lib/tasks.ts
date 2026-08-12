/**
 * Who owns a piece of work, and what may happen to it next.
 *
 * The punch list already answered "what is still open on this customer". It
 * could not answer "who is doing it", which is the question a supervisor
 * actually has on a Monday morning, and the one the TRD's work-order lifecycle
 * is for.
 *
 * ## Why this is a state machine rather than a status field
 *
 * A free-text status is a field somebody sets to whatever they like, and a
 * board built on one tells you nothing you can act on. The states below are the
 * TRD's, in order, and the transitions between them are decided here rather
 * than by whichever button happened to be on screen.
 *
 * Two of the six carry the weight:
 *
 *   - **`assigned` and beyond require an assignee.** Otherwise "Assigned" means
 *     nothing and the board fills with work nobody owns — which is the failure
 *     this feature exists to fix, reproduced inside the fix.
 *   - **`verified` is only reachable from `done`.** `done` is the claim that
 *     the work is finished; `verified` is somebody having looked. A task that
 *     can jump to Verified from In Progress has one state, wearing two names.
 *
 * ## What is NOT decided here
 *
 * Whether a task that corrects a punch item is finished. That lives in the
 * customer's `punchResolutions`, where the punch list already reads it, and
 * `effectiveState` reads it back rather than storing a second copy. Two records
 * both claiming to know whether a deficiency was corrected is a disagreement
 * waiting to happen, and the one that would be believed is whichever screen
 * somebody opened.
 */
import type { PunchResolution, Task, TaskEvent, TaskState } from './types';
import type { PunchItem } from './punch';

/** In lifecycle order. Index is meaningful — `stateIndex` depends on it. */
export const TASK_STATES: TaskState[] = [
  'new',
  'assigned',
  'todo',
  'in-progress',
  'done',
  'verified',
];

export const TASK_LABELS: Record<TaskState, string> = {
  new: 'New',
  assigned: 'Assigned',
  todo: 'To do',
  'in-progress': 'In progress',
  done: 'Done',
  verified: 'Verified',
};

/** States at or past which the task must have somebody's name on it. */
const NEEDS_ASSIGNEE = TASK_STATES.indexOf('assigned');

export function stateIndex(state: TaskState): number {
  return TASK_STATES.indexOf(state);
}

/** Still someone's problem. */
export function isOpen(state: TaskState): boolean {
  return state !== 'verified';
}

/**
 * Whether a move is allowed, and if not, what to tell the person who tried.
 *
 * A discriminated union rather than a boolean, because "no" without a reason
 * turns into a button that does nothing when pressed — and the reasons here are
 * all things the person can fix.
 */
export type MoveDecision = { ok: true } | { ok: false; reason: string };

export function canMove(
  task: Pick<Task, 'state' | 'assignee' | 'archived'>,
  to: TaskState,
  options: { note?: string } = {},
): MoveDecision {
  if (task.archived) {
    return { ok: false, reason: 'This task has been archived.' };
  }
  if (to === task.state) {
    return { ok: false, reason: `It is already ${TASK_LABELS[to].toLowerCase()}.` };
  }

  const from = stateIndex(task.state);
  const target = stateIndex(to);
  if (target < 0) return { ok: false, reason: 'That is not a state a task can be in.' };

  // Backwards is rework, and rework is ordinary — except out of Verified, which
  // unsays something somebody already signed their name to. Same rule as
  // reopening a signed inspection: allowed, but not silently.
  if (target < from) {
    if (task.state === 'verified' && !options.note?.trim()) {
      return {
        ok: false,
        reason: 'Reopening a verified task is recorded permanently. Say why it is being reopened.',
      };
    }
    return { ok: true };
  }

  if (target >= NEEDS_ASSIGNEE && !task.assignee?.trim()) {
    return { ok: false, reason: 'Give the task to somebody first.' };
  }

  if (to === 'verified' && task.state !== 'done') {
    return {
      ok: false,
      reason: 'Somebody has to mark the work done before it can be verified.',
    };
  }

  return { ok: true };
}

/** Every state this task could legally be moved to right now. */
export function legalMoves(task: Pick<Task, 'state' | 'assignee' | 'archived'>): TaskState[] {
  // A note is assumed available: the caller asks for one when it is needed, and
  // a move that is only blocked for want of a reason still belongs on the menu.
  return TASK_STATES.filter((state) => canMove(task, state, { note: '.' }).ok);
}

/**
 * Move a task, appending to its history rather than overwriting it.
 *
 * The caller is expected to have checked `canMove` — this repeats the check so
 * that a screen that forgets to cannot write an illegal state, and returns the
 * task untouched rather than throwing, because a thrown error in an offline
 * write path loses the change.
 */
export function applyMove(
  task: Task,
  to: TaskState,
  actor: { by?: string; note?: string; now: string },
): Task {
  if (!canMove(task, to, { note: actor.note }).ok) return task;

  const event: TaskEvent = { at: actor.now, to };
  if (actor.by) event.by = actor.by;
  if (actor.note?.trim()) event.note = actor.note.trim();

  return {
    ...task,
    state: to,
    history: [...task.history, event],
    updatedAt: actor.now,
  };
}

/**
 * What the task's state actually is, once the punch list has had its say.
 *
 * A task raised from a failed checkpoint is finished when that checkpoint is
 * recorded as corrected, and that record lives on the customer because the
 * punch list has always kept it there. Reading it back here — rather than
 * copying it onto the task — is what makes it impossible for the punch screen
 * and the task board to disagree about the same deficiency.
 */
export function effectiveState(
  task: Task,
  resolutions: Record<string, PunchResolution> | undefined,
): TaskState {
  if (task.punchKey && resolutions?.[task.punchKey]) return 'verified';
  return task.state;
}

/**
 * The same account marked the work done and then verified it.
 *
 * Not blocked. A two-person company would deadlock on a rule that demands a
 * second account, and a feature that cannot be used on a small job is one that
 * gets worked around rather than followed. It is recorded and shown instead —
 * the same choice the pencil-whipping checks make, for the same reason.
 */
export function selfVerified(task: Task): boolean {
  const done = lastEventTo(task, 'done');
  const verified = lastEventTo(task, 'verified');
  if (!done?.by || !verified?.by) return false;
  return done.by === verified.by;
}

function lastEventTo(task: Task, state: TaskState): TaskEvent | undefined {
  for (let index = task.history.length - 1; index >= 0; index -= 1) {
    if (task.history[index].to === state) return task.history[index];
  }
  return undefined;
}

export type DueState = 'overdue' | 'today' | 'soon' | 'later';

/**
 * `today` is a date string rather than a Date so that the comparison happens in
 * whatever day the device thinks it is. A due date typed as a day is a day; run
 * through a timestamp it becomes midnight somewhere and reads as overdue an
 * afternoon early for anybody west of it.
 */
export function dueState(dueDate: string | undefined, today: string): DueState | undefined {
  if (!dueDate) return undefined;
  if (dueDate < today) return 'overdue';
  if (dueDate === today) return 'today';
  const soon = new Date(`${today}T00:00:00Z`);
  soon.setUTCDate(soon.getUTCDate() + 3);
  return dueDate <= soon.toISOString().slice(0, 10) ? 'soon' : 'later';
}

export interface TaskView extends Task {
  /** State after the punch list has been consulted. */
  effective: TaskState;
  due?: DueState;
}

/**
 * The board, in the order somebody scanning it should meet things.
 *
 * Critical first, then overdue, then by due date, then oldest — a supervisor
 * looking at this list is deciding what to do next, and the thing that holds a
 * job belongs at the top of it whatever its due date says.
 */
export function orderTasks(
  tasks: Task[],
  resolutions: Record<string, PunchResolution> | undefined,
  today: string,
): TaskView[] {
  const views = tasks
    .filter((task) => !task.archived)
    .map((task) => ({
      ...task,
      effective: effectiveState(task, resolutions),
      due: dueState(task.dueDate, today),
    }));

  const rank = (view: TaskView) => (view.due === 'overdue' ? 0 : view.due === 'today' ? 1 : 2);

  return views.sort(
    (a, b) =>
      Number(b.critical ?? false) - Number(a.critical ?? false) ||
      rank(a) - rank(b) ||
      (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999') ||
      a.createdAt.localeCompare(b.createdAt),
  );
}

/** Counts for the board's column headers, using effective states. */
export function countByState(views: TaskView[]): Record<TaskState, number> {
  const counts = Object.fromEntries(TASK_STATES.map((state) => [state, 0])) as Record<
    TaskState,
    number
  >;
  for (const view of views) counts[view.effective] += 1;
  return counts;
}

/**
 * Raise a task from a failed checkpoint.
 *
 * The title is the checkpoint's wording as it was actually failed, copied for
 * the list only — `punchKey` is what ties the task to the deficiency, and the
 * punch list keeps reading the wording out of the frozen snapshot regardless of
 * what is written here.
 */
export function taskFromPunchItem(
  item: PunchItem,
  input: { customerId: string; id: string; by?: string; now: string },
): Task {
  return {
    id: input.id,
    customerId: input.customerId,
    punchKey: item.key,
    inspectionId: item.inspectionId,
    title: item.question.text,
    detail: item.response.note?.trim() || undefined,
    state: 'new',
    critical: item.critical || undefined,
    history: [{ at: input.now, to: 'new', ...(input.by ? { by: input.by } : {}) }],
    createdBy: input.by,
    createdAt: input.now,
    updatedAt: input.now,
  };
}

/** Punch items that nobody has raised a task for yet. */
export function unassignedPunchItems(items: PunchItem[], tasks: Task[]): PunchItem[] {
  const claimed = new Set(
    tasks.filter((task) => !task.archived && task.punchKey).map((task) => task.punchKey!),
  );
  return items.filter((item) => !claimed.has(item.key));
}

/**
 * The resolution to write when a linked task is verified.
 *
 * Verifying such a task does not set its state — it records the deficiency as
 * corrected, which is where the punch list has always looked and what
 * `effectiveState` reads back.
 */
export function resolutionFor(actor: { by?: string; note?: string; now: string }): PunchResolution {
  const resolution: PunchResolution = { at: actor.now };
  if (actor.by) resolution.by = actor.by;
  if (actor.note?.trim()) resolution.note = actor.note.trim();
  return resolution;
}
