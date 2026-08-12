/**
 * Who owns a piece of work, and what may happen to it next.
 *
 * A work-order board is only worth having if its states mean something. The
 * failures worth guarding are the ones that quietly turn six states back into
 * one: a task reaching Verified without anybody claiming the work was done, a
 * task sitting in Assigned with nobody's name on it, or a state nothing can be
 * moved out of — a piece of work that disappears from the board while still
 * being somebody's problem.
 *
 * The other half is the punch list. A deficiency must not be able to read as
 * corrected on one screen and open on another.
 */
import { build } from 'vite';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const out = mkdtempSync(join(tmpdir(), 'qc-tasks-'));

await build({
  logLevel: 'error',
  build: {
    lib: {
      entry: new URL('../src/lib/tasks.ts', import.meta.url).pathname,
      formats: ['es'],
      fileName: 'tasks',
    },
    outDir: out,
    emptyOutDir: true,
    minify: false,
  },
});

const t = await import(join(out, 'tasks.js'));

let failures = 0;
function check(name, fn) {
  try {
    fn();
    console.log(`  ok  ${name}`);
  } catch (error) {
    failures += 1;
    console.log(`FAIL  ${name}\n      ${error.message.split('\n')[0]}`);
  }
}

const NOW = '2026-08-12T12:00:00.000Z';
const TODAY = '2026-08-12';

const task = (over = {}) => ({
  id: 'task_1',
  customerId: 'cust_1',
  title: 'Seal the rim joist at the south wall',
  state: 'new',
  history: [{ at: '2026-08-01T09:00:00.000Z', to: 'new' }],
  createdAt: '2026-08-01T09:00:00.000Z',
  updatedAt: '2026-08-01T09:00:00.000Z',
  ...over,
});

// ---------------------------------------------------------------------------
// The two rules that make the six states mean something.
// ---------------------------------------------------------------------------

check('THE POINT OF SIX STATES: Verified is only reachable from Done', () => {
  // Done is the claim that the work is finished; Verified is somebody having
  // looked. A task that can jump straight there has one state under two names.
  const working = task({ state: 'in-progress', assignee: 'M. Okafor' });
  const decision = t.canMove(working, 'verified');
  assert.equal(decision.ok, false);
  assert.match(decision.reason, /done before it can be verified/i);

  const done = task({ state: 'done', assignee: 'M. Okafor' });
  assert.equal(t.canMove(done, 'verified').ok, true);
});

check('THE OWNERLESS TASK: Assigned and beyond need somebody', () => {
  // A board full of work nobody owns is the failure this feature exists to
  // fix. Reproducing it inside the fix is the easiest way to ship nothing.
  for (const state of ['assigned', 'todo', 'in-progress', 'done']) {
    const decision = t.canMove(task({ state: 'new' }), state);
    assert.equal(decision.ok, false, `${state} was allowed with no assignee`);
    assert.match(decision.reason, /give the task to somebody/i);
  }
  assert.equal(t.canMove(task({ state: 'new', assignee: 'M. Okafor' }), 'assigned').ok, true);
});

check('a blank assignee is not an assignee', () => {
  assert.equal(t.canMove(task({ state: 'new', assignee: '   ' }), 'assigned').ok, false);
});

// ---------------------------------------------------------------------------
// Nothing gets stuck.
// ---------------------------------------------------------------------------

check('THE DEAD END: every state has somewhere to go', () => {
  // A task nothing can be moved out of vanishes from the board while still
  // being somebody's problem, and no error is ever raised about it.
  for (const state of t.TASK_STATES) {
    const moves = t.legalMoves(task({ state, assignee: 'M. Okafor' }));
    assert.ok(moves.length > 0, `a task in ${state} cannot be moved anywhere`);
  }
});

check('and an unassigned task can always be given to somebody', () => {
  const moves = t.legalMoves(task({ state: 'new' }));
  assert.deepEqual(moves, [], 'an unassigned New task should offer no forward move');
  // ...which is only acceptable because assigning is not a move: it is setting
  // the assignee, after which the moves appear.
  assert.ok(t.legalMoves(task({ state: 'new', assignee: 'M. Okafor' })).length > 0);
});

check('rework is ordinary and needs no ceremony', () => {
  const decision = t.canMove(task({ state: 'done', assignee: 'M. Okafor' }), 'in-progress');
  assert.equal(decision.ok, true);
});

check('THE UNSAYING: reopening a verified task demands a reason', () => {
  // Same rule as unlocking a signed inspection. Somebody put their name to
  // this; taking that back is allowed, but not silently.
  const verified = task({ state: 'verified', assignee: 'M. Okafor' });
  const bare = t.canMove(verified, 'in-progress');
  assert.equal(bare.ok, false);
  assert.match(bare.reason, /recorded permanently/i);
  assert.equal(t.canMove(verified, 'in-progress', { note: 'the seal failed again' }).ok, true);
});

check('an archived task does not move at all', () => {
  const archived = task({ state: 'todo', assignee: 'M. Okafor', archived: true });
  assert.equal(t.canMove(archived, 'in-progress').ok, false);
  assert.deepEqual(t.legalMoves(archived), []);
});

check('moving a task to the state it is already in is refused', () => {
  assert.equal(t.canMove(task({ state: 'todo', assignee: 'M' }), 'todo').ok, false);
});

check('an unknown state is not a state', () => {
  assert.equal(t.canMove(task({ state: 'todo', assignee: 'M' }), 'finished').ok, false);
});

// ---------------------------------------------------------------------------
// Applying a move.
// ---------------------------------------------------------------------------

check('a move is appended to the history, never overwritten', () => {
  // The history is the answer to "who moved this, and when". Rewriting the last
  // entry instead of adding one would make it a status field with extra steps.
  const before = task({ state: 'done', assignee: 'M. Okafor' });
  const after = t.applyMove(before, 'verified', { by: 'sup@co.com', now: NOW, note: 'looks good' });
  assert.equal(after.state, 'verified');
  assert.equal(after.history.length, before.history.length + 1);
  assert.deepEqual(after.history[0], before.history[0], 'earlier history was rewritten');
  assert.deepEqual(after.history.at(-1), {
    at: NOW,
    to: 'verified',
    by: 'sup@co.com',
    note: 'looks good',
  });
  assert.equal(after.updatedAt, NOW);
});

check('AN ILLEGAL MOVE CHANGES NOTHING, and does not throw', () => {
  // This runs in an offline write path. A thrown error there loses the change
  // and everything queued behind it, which is a worse outcome than a button
  // that appears not to have worked.
  const before = task({ state: 'todo', assignee: 'M. Okafor' });
  const after = t.applyMove(before, 'verified', { by: 'a@co.com', now: NOW });
  assert.deepEqual(after, before);
});

check('a blank note is not recorded as a note', () => {
  const after = t.applyMove(task({ state: 'new', assignee: 'M' }), 'assigned', {
    now: NOW,
    note: '   ',
  });
  assert.equal(after.history.at(-1).note, undefined);
});

// ---------------------------------------------------------------------------
// The punch list and the board cannot disagree.
// ---------------------------------------------------------------------------

check('THE TWO TRUTHS: a corrected deficiency reads as verified on the board', () => {
  // The punch list has always kept corrections on the customer. If the task
  // stored its own copy, the two screens would eventually say different things
  // about the same deficiency and the believed one would be whichever was open.
  const linked = task({ state: 'in-progress', assignee: 'M. Okafor', punchKey: 'insp_1:q7' });
  assert.equal(t.effectiveState(linked, {}), 'in-progress');
  assert.equal(
    t.effectiveState(linked, { 'insp_1:q7': { at: NOW, by: 'sup@co.com' } }),
    'verified',
  );
});

check('a resolution on a different checkpoint does not close this one', () => {
  const linked = task({ state: 'todo', assignee: 'M', punchKey: 'insp_1:q7' });
  assert.equal(t.effectiveState(linked, { 'insp_1:q8': { at: NOW } }), 'todo');
});

check('a standalone work order is not affected by the punch list at all', () => {
  // "Order the part" has no failed checkpoint behind it, so nothing on the
  // customer can close it.
  const standalone = task({ state: 'done', assignee: 'M' });
  assert.equal(t.effectiveState(standalone, { 'insp_1:q7': { at: NOW } }), 'done');
});

check('a punch item already raised as a task is not offered again', () => {
  const items = [{ key: 'insp_1:q7' }, { key: 'insp_1:q9' }];
  const tasks = [task({ punchKey: 'insp_1:q7' })];
  assert.deepEqual(
    t.unassignedPunchItems(items, tasks).map((item) => item.key),
    ['insp_1:q9'],
  );
});

check('an archived task releases its punch item', () => {
  // Otherwise deleting a task raised by mistake makes that deficiency
  // permanently unassignable, with nothing on screen explaining why.
  const items = [{ key: 'insp_1:q7' }];
  const tasks = [task({ punchKey: 'insp_1:q7', archived: true })];
  assert.equal(t.unassignedPunchItems(items, tasks).length, 1);
});

check('a task raised from a punch item carries the link, not a second copy', () => {
  const item = {
    key: 'insp_1:q7',
    inspectionId: 'insp_1',
    critical: true,
    question: { id: 'q7', text: 'Rim joist sealed at the south wall' },
    response: { note: 'left open', photoIds: [], answer: 'no' },
  };
  const raised = t.taskFromPunchItem(item, { customerId: 'cust_1', id: 'task_9', now: NOW });
  assert.equal(raised.punchKey, 'insp_1:q7');
  assert.equal(raised.inspectionId, 'insp_1');
  assert.equal(raised.critical, true);
  assert.equal(raised.state, 'new');
  assert.equal(raised.history.length, 1);
  assert.equal(raised.assignee, undefined, 'a raised task should start owned by nobody');
});

// ---------------------------------------------------------------------------
// Who checked whose work.
// ---------------------------------------------------------------------------

check('the same account marking Done and Verified is recorded as such', () => {
  // Not blocked — a two-person company would deadlock on a rule demanding a
  // second account, and a rule that cannot be followed gets worked around.
  const same = task({
    state: 'verified',
    history: [
      { at: NOW, to: 'done', by: 'm@co.com' },
      { at: NOW, to: 'verified', by: 'm@co.com' },
    ],
  });
  assert.equal(t.selfVerified(same), true);
});

check('two different accounts are not self-verification', () => {
  const proper = task({
    state: 'verified',
    history: [
      { at: NOW, to: 'done', by: 'm@co.com' },
      { at: NOW, to: 'verified', by: 'sup@co.com' },
    ],
  });
  assert.equal(t.selfVerified(proper), false);
});

check('only the latest Done counts, so rework clears an earlier flag', () => {
  const reworked = task({
    state: 'verified',
    history: [
      { at: '2026-08-01T00:00:00.000Z', to: 'done', by: 'm@co.com' },
      { at: '2026-08-02T00:00:00.000Z', to: 'in-progress', by: 'sup@co.com' },
      { at: '2026-08-03T00:00:00.000Z', to: 'done', by: 'j@co.com' },
      { at: '2026-08-04T00:00:00.000Z', to: 'verified', by: 'm@co.com' },
    ],
  });
  assert.equal(t.selfVerified(reworked), false);
});

check('local-only data, with no accounts on it, is not accused of anything', () => {
  const offline = task({
    state: 'verified',
    history: [
      { at: NOW, to: 'done' },
      { at: NOW, to: 'verified' },
    ],
  });
  assert.equal(t.selfVerified(offline), false);
});

// ---------------------------------------------------------------------------
// Due dates and ordering.
// ---------------------------------------------------------------------------

check('THE TIME ZONE: a due date is a day, not a moment', () => {
  // Run through a timestamp, a date typed as a day becomes midnight somewhere
  // and reads as overdue an afternoon early for everybody west of it.
  assert.equal(t.dueState('2026-08-12', TODAY), 'today');
  assert.equal(t.dueState('2026-08-11', TODAY), 'overdue');
  assert.equal(t.dueState('2026-08-14', TODAY), 'soon');
  assert.equal(t.dueState('2026-09-30', TODAY), 'later');
  assert.equal(t.dueState(undefined, TODAY), undefined);
});

check('the soon window crosses a month end', () => {
  assert.equal(t.dueState('2026-09-02', '2026-08-31'), 'soon');
  assert.equal(t.dueState('2026-09-05', '2026-08-31'), 'later');
});

check('what holds a job sorts above what is merely late', () => {
  const views = t.orderTasks(
    [
      task({ id: 'late', dueDate: '2026-08-01' }),
      task({ id: 'critical', critical: true, dueDate: '2026-12-01' }),
      task({ id: 'someday' }),
    ],
    {},
    TODAY,
  );
  assert.deepEqual(
    views.map((view) => view.id),
    ['critical', 'late', 'someday'],
  );
});

check('a task with no due date sorts after one that has one', () => {
  const views = t.orderTasks(
    [task({ id: 'undated' }), task({ id: 'dated', dueDate: '2026-09-01' })],
    {},
    TODAY,
  );
  assert.deepEqual(
    views.map((view) => view.id),
    ['dated', 'undated'],
  );
});

check('archived tasks are not on the board', () => {
  const views = t.orderTasks([task({ id: 'gone', archived: true }), task({ id: 'here' })], {}, TODAY);
  assert.deepEqual(
    views.map((view) => view.id),
    ['here'],
  );
});

check('the column counts use the effective state, not the stored one', () => {
  // Otherwise a deficiency corrected on the punch screen keeps a task sitting
  // in the In Progress column, and the board is wrong in the direction that
  // makes people stop reading it.
  const views = t.orderTasks(
    [
      task({ id: 'a', state: 'in-progress', punchKey: 'insp_1:q7' }),
      task({ id: 'b', state: 'todo' }),
    ],
    { 'insp_1:q7': { at: NOW } },
    TODAY,
  );
  const counts = t.countByState(views);
  assert.equal(counts.verified, 1);
  assert.equal(counts['in-progress'], 0);
  assert.equal(counts.todo, 1);
});

check('every state has a column, including the empty ones', () => {
  const counts = t.countByState([]);
  assert.deepEqual(Object.keys(counts).sort(), [...t.TASK_STATES].sort());
  assert.ok(Object.values(counts).every((value) => value === 0));
});

console.log(failures === 0 ? '\nAll task checks passed.\n' : `\n${failures} FAILED\n`);
process.exit(failures === 0 ? 0 : 1);
