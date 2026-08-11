-- ---------------------------------------------------------------------------
-- QC2GO — align the schema with the app's domain model
--
-- 0001 was written against an earlier model where the organizing record was a
-- "job" with a name of its own. The app now hangs everything off the customer:
-- "Job Name" was removed, job notes became the work scope, a customer carries
-- the checklists that apply to it and the GPS point captured on site, and an
-- inspection covers a single day because jobs run across several days with a
-- different area of focus each day.
--
-- Renaming rather than recreating keeps the row-level security, the triggers
-- and the foreign keys intact.
-- ---------------------------------------------------------------------------

-- The summary view reads columns that are about to change shape, so it goes
-- first and is rebuilt at the end.
drop view if exists public.inspection_summary;

-- ---------------------------------------------------------------------------
-- jobs -> customers
-- ---------------------------------------------------------------------------

alter table public.jobs rename to customers;

-- The job name is gone: a customer is identified by who they are and where they
-- live. Dropping the column takes its full-text index with it.
alter table public.customers drop column name;

alter table public.customers rename column notes to work_scope;

-- The checklists chosen for this customer when the record was created. Text ids
-- rather than a join table: templates are seeded from code and an inspection
-- freezes its own snapshot anyway, so referential integrity here would only
-- stand in the way of archiving a template.
alter table public.customers add column template_ids text[] not null default '{}'::text[];

-- {lat, lng, accuracy, capturedAt} captured from the device's GPS while standing
-- at the property. Addresses are never geocoded — that would be a network call
-- in exactly the places where there is no signal.
alter table public.customers add column location jsonb;

alter table public.customers rename constraint jobs_created_by_fkey to customers_created_by_fkey;

alter index public.jobs_pkey        rename to customers_pkey;
alter index public.jobs_updated_idx rename to customers_updated_idx;

-- What the home screen searches on.
create index customers_search_idx on public.customers
  using gin (to_tsvector('english', customer_name || ' ' || address));

alter trigger jobs_touch on public.customers rename to customers_touch;

alter policy jobs_select       on public.customers rename to customers_select;
alter policy jobs_insert       on public.customers rename to customers_insert;
alter policy jobs_update       on public.customers rename to customers_update;
alter policy jobs_admin_delete on public.customers rename to customers_admin_delete;

-- ---------------------------------------------------------------------------
-- inspections
-- ---------------------------------------------------------------------------

alter table public.inspections rename column job_id to customer_id;
alter table public.inspections rename constraint inspections_job_id_fkey to inspections_customer_id_fkey;

-- The day this inspection covers. A customer accumulates one QC card per visit
-- day, so this is what the cards group and sort by. Existing rows take the day
-- they were created, which is what they meant before the column existed.
alter table public.inspections add column visit_date date not null default current_date;
update public.inspections set visit_date = created_at::date;

alter index public.inspections_job_idx rename to inspections_customer_idx;
create index inspections_visit_date_idx on public.inspections (customer_id, visit_date desc);

-- ---------------------------------------------------------------------------
-- Harden the updated_at trigger
--
-- Flagged by the database linter: without a pinned search_path the function
-- resolves names against whatever the caller's path happens to be.
-- ---------------------------------------------------------------------------

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Office summary — rebuilt against the renamed columns
-- ---------------------------------------------------------------------------

create view public.inspection_summary
with (security_invoker = true)
as
select
  i.id,
  i.customer_id,
  c.customer_name,
  c.address,
  c.salesperson,
  c.team_leader,
  i.snapshot ->> 'templateName' as checklist,
  i.visit_type,
  i.visit_date,
  i.status,
  i.info ->> 'inspector'  as inspector,
  i.completed_at,
  (
    select count(*) from jsonb_each(i.responses) r
    where r.value ->> 'answer' = 'yes'
  ) as passed,
  (
    select count(*) from jsonb_each(i.responses) r
    where r.value ->> 'answer' = 'no'
  ) as failed,
  (
    select count(*) from jsonb_each(i.responses) r
    where r.value ->> 'answer' = 'na'
  ) as not_applicable
from public.inspections i
join public.customers c on c.id = i.customer_id;
