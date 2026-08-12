-- Tasks and work orders.
--
-- The punch list could already say what was still open on a customer. It could
-- not say who was doing it, which is the question a supervisor has on a Monday
-- morning and the reason the TRD models a work-order lifecycle at all.
--
-- Two things this table deliberately does not hold.
--
-- It does not copy the checkpoint's wording as the authority. `title` is a
-- convenience for a list; `punch_key` is the link, and the punch list keeps
-- reading the real wording out of the inspection's frozen snapshot. A signed
-- record must not acquire a second, editable version of itself.
--
-- It does not record whether the deficiency was corrected. That has always
-- lived in `customers.punch_resolutions`, and it stays there — two rows both
-- claiming to know would eventually disagree, and the one believed would be
-- whichever screen somebody happened to open.

create table if not exists public.tasks (
  id text primary key,
  org_id uuid not null references public.organizations (id) on delete cascade,
  customer_id text not null references public.customers (id) on delete cascade,
  -- Nullable: a standalone work order has no inspection behind it.
  inspection_id text,
  -- `<inspection_id>:<response key>`, matching `punchKey` on the device.
  punch_key text,
  title text not null,
  detail text,
  state text not null default 'new',
  -- A name from the admin-maintained roster, not an account. The roster is
  -- cached on the device, which is what lets a task be assigned with no signal.
  assignee text,
  critical boolean not null default false,
  -- A day as typed. Not a timestamp: a due date run through one becomes
  -- midnight somewhere and reads as overdue an afternoon early to the west.
  due_date date,
  history jsonb not null default '[]'::jsonb,
  archived boolean not null default false,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- The lifecycle is enforced in the app, where it can explain itself. What the
-- database refuses is a value that is not a state at all — a typo in a client
-- would otherwise put a task in a column that does not exist on any board.
alter table public.tasks drop constraint if exists tasks_state_check;
alter table public.tasks
  add constraint tasks_state_check
  check (state in ('new', 'assigned', 'todo', 'in-progress', 'done', 'verified'));

-- The board is read per company and per customer, and the sync engine pulls by
-- watermark, so those are the three shapes of every query against this table.
create index if not exists tasks_org_updated_idx on public.tasks (org_id, updated_at);
create index if not exists tasks_customer_idx on public.tasks (customer_id);
-- One task per deficiency. Raising a second on the same checkpoint would put
-- two rows on the board that close each other, and neither would look wrong.
create unique index if not exists tasks_punch_key_idx
  on public.tasks (org_id, punch_key)
  where punch_key is not null and archived = false;

alter table public.tasks enable row level security;

-- The same boundary as every other tenant-owned table: one scalar comparison,
-- no join, because `profiles.org_id` puts an account in exactly one company.
drop policy if exists "tasks are readable within the company" on public.tasks;
create policy "tasks are readable within the company"
  on public.tasks for select
  using (org_id = public.current_org_id());

drop policy if exists "tasks are insertable within the company" on public.tasks;
create policy "tasks are insertable within the company"
  on public.tasks for insert
  with check (org_id = public.current_org_id());

-- Anybody in the company may move a task. The record of who did lives in
-- `history`, which is appended to rather than overwritten.
drop policy if exists "tasks are updatable within the company" on public.tasks;
create policy "tasks are updatable within the company"
  on public.tasks for update
  using (org_id = public.current_org_id())
  with check (org_id = public.current_org_id());

drop policy if exists "tasks are deletable within the company" on public.tasks;
create policy "tasks are deletable within the company"
  on public.tasks for delete
  using (org_id = public.current_org_id());

-- A device that was offline when a task was deleted has no other way to learn
-- it is gone: the pull only ever sees rows that still exist. Every other synced
-- entity leaves a marker, and one that did not would leave dead work orders on
-- a board that nothing could remove.
-- `tombstones.entity` is a closed list, so it has to be told about this one
-- first. Without this the trigger below raises on every delete, which would
-- surface as "the task will not delete" rather than as anything about a check
-- constraint.
alter table public.tombstones drop constraint if exists tombstones_entity_check;
alter table public.tombstones
  add constraint tombstones_entity_check
  check (entity in ('customer', 'inspection', 'photo', 'template', 'task'));

drop trigger if exists tasks_tombstone on public.tasks;
create trigger tasks_tombstone after delete on public.tasks
  for each row execute function public.record_tombstone('task');

-- Whether a work order has to be verified by somebody other than whoever
-- marked it done. A company decision, not ours: some crews want a second pair
-- of eyes on every correction, and a two-person company enforcing that would
-- deadlock on its own rule. Off by default, which leaves self-verification
-- possible and merely recorded.
alter table public.shared_config
  add column if not exists require_second_verifier boolean not null default false;
