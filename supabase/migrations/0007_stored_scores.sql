-- ---------------------------------------------------------------------------
-- QC2GO — the score, written down
--
-- Scores were computed on every read, from the raw responses, by the app. That
-- is exactly right while the checklist snapshot is frozen alongside them: the
-- number can never drift from what the inspection actually said, because it is
-- derived from it every time.
--
-- It stops being enough the moment anything outside the app wants the result.
-- A webhook has to state a score in its body. A spreadsheet export cannot run
-- the app's code to derive one. The TRD's payload carries `overall_score`,
-- `pass_fail_status` and `total_deficiencies` as fields. And `inspection_summary`
-- was quietly a *second* implementation of the same rule, counting answers in
-- SQL — free to disagree with the first and with nothing to say so.
--
-- So the number is written down at sign-off, by the same code the UI uses, and
-- the view stops recounting.
--
-- In-progress inspections keep computing live. The number has to move as
-- questions are answered, and there is nothing to be faithful to yet.
-- ---------------------------------------------------------------------------

drop view if exists public.inspection_summary;

alter table public.inspections
  -- Percentage of judged items that passed. N/A is excluded rather than counted
  -- as a pass, so skipping half a checklist cannot inflate it.
  add column overall_score integer,
  -- PASS / FAIL / NEEDS_REVIEW, matching the TRD's payload vocabulary. A single
  -- critical failure forces FAIL however high the percentage.
  add column pass_fail_status text,
  add column total_deficiencies integer;

alter table public.inspections add constraint inspections_score_range
  check (overall_score is null or (overall_score between 0 and 100));

alter table public.inspections add constraint inspections_pass_fail_known
  check (pass_fail_status is null or pass_fail_status in ('PASS', 'FAIL', 'NEEDS_REVIEW'));

-- Null until sign-off, and that is the honest state: an inspection halfway
-- through does not have a result yet. Anything reading these should read
-- completed rows.
comment on column public.inspections.overall_score is
  'Written at sign-off by the app. Null while in progress — see 0007.';

create index inspections_score_idx
  on public.inspections (org_id, pass_fail_status, completed_at desc)
  where status = 'completed';

-- ---------------------------------------------------------------------------
-- Office summary — reading the stored result rather than recounting
-- ---------------------------------------------------------------------------

create view public.inspection_summary
with (security_invoker = true)
as
select
  i.id,
  i.org_id,
  o.name          as organization,
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
  i.overall_score,
  i.pass_fail_status,
  i.total_deficiencies,
  -- The raw counts stay: they are what a spreadsheet wants beside the score,
  -- and unlike the score they are a description of the answers rather than a
  -- second opinion about them.
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
join public.customers     c on c.id = i.customer_id
join public.organizations o on o.id = i.org_id;
