-- ---------------------------------------------------------------------------
-- QC2GO — sections that run once per thing
--
-- A ductless job with five indoor heads asks the same questions five times.
-- Until now that meant either five hand-authored copies of the same section, or
-- one set of checkpoints covering all five heads at once — which loses which
-- head actually failed, and that is the only thing anybody wants to know.
--
-- A section can now be marked repeatable in the checklist, and the inspector
-- adds instances of it while standing in the building. The checklist says a
-- section repeats; how many times is a fact about the job, not the template.
--
--   sections:          [{ "id": "s3", "repeatable": true, "instanceNoun": "Head" }]
--   section_instances: { "s3": [{ "id": "i1", "label": "Primary bedroom" }] }
--
-- Answers stay in the same flat `responses` map, keyed `<questionId>#<instanceId>`
-- inside a repeatable section and by bare question id everywhere else. That is
-- the reason for the composite key rather than a nested map: every inspection
-- signed before today has no instances, so every one of its keys is still a
-- bare question id and nothing about those records has moved.
-- ---------------------------------------------------------------------------

alter table public.inspections
  add column section_instances jsonb not null default '{}'::jsonb;

comment on column public.inspections.section_instances is
  'Instances of each repeatable section, keyed by section id. Answers live in '
  '`responses` under <questionId>#<instanceId>. See 0012.';
