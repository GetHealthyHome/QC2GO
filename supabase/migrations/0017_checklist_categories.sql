-- ---------------------------------------------------------------------------
-- QC2GO — checklist categories become a list the office maintains
--
-- A checklist's category was free text typed into the editor. Two admins
-- describing the same kind of work would type "Home Performance", "home
-- performance" and "HomePerf", and the picker would group them as three
-- unrelated kinds of job — the grouping being the only thing a category is for.
--
-- So it becomes a pick list, alongside the salesperson and team-leader lists
-- 0003 added, and for the same reason: these are plain strings the office
-- maintains, not records with an identity of their own. The column is on
-- `shared_config` because a category belongs to the company rather than to any
-- one checklist.
--
-- Deliberately not a constraint on `templates.category`. The shipped checklists
-- carry their own slugs, an existing company has whatever its admins have
-- already typed, and a foreign key here would refuse the next write from a
-- device that has not yet pulled a newly added category. The list is what the
-- editor offers; it is not a rule about what a row may hold.
-- ---------------------------------------------------------------------------

alter table public.shared_config
  add column categories text[] not null default '{}'::text[];
