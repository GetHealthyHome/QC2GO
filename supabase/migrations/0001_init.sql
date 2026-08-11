-- QC2GO schema.
--
-- Run this on a fresh Supabase project (SQL Editor, or `supabase db push`).
-- Auth is email + password. Two roles:
--   admin     — everything, plus authoring checklist templates
--   inspector — runs inspections, reads every completed report
--
-- The design rule that shapes this file: a signed inspection is a record.
-- Editing a template must never change what a past inspection said, so each
-- inspection stores its own frozen copy of the checklist in `snapshot`.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Profiles and roles
-- ---------------------------------------------------------------------------

create type public.user_role as enum ('admin', 'inspector');

create table public.profiles (
  id          uuid primary key references auth.users on delete cascade,
  email       text        not null,
  full_name   text        not null default '',
  role        public.user_role not null default 'inspector',
  active      boolean     not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- New signups land as inspectors. Promote to admin deliberately, in SQL:
--   update public.profiles set role = 'admin' where email = 'you@example.com';
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', '')
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Reading the caller's role from inside a policy on `profiles` would recurse,
-- so this reads it with definer rights instead.
create or replace function public.current_role_is_admin()
returns boolean
language sql
stable
security definer set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and role = 'admin'
  );
$$;

-- ---------------------------------------------------------------------------
-- Checklist templates (admin-authored)
-- ---------------------------------------------------------------------------

create table public.templates (
  id          text primary key,
  name        text        not null,
  category    text        not null default 'custom',
  summary     text        not null default '',
  -- Section[] exactly as the app models it: [{id, title, description, questions: [...]}]
  sections    jsonb       not null default '[]'::jsonb,
  built_in    boolean     not null default false,
  archived    boolean     not null default false,
  version     integer     not null default 1,
  created_by  uuid        references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- The Job Information fields and Universal QC Standards shared by every
-- checklist. Exactly one row, pinned by the `singleton` check.
create table public.shared_config (
  singleton         boolean primary key default true check (singleton),
  info_fields       jsonb       not null default '[]'::jsonb,
  universal_section jsonb       not null default '{}'::jsonb,
  updated_at        timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Jobs and inspections
-- ---------------------------------------------------------------------------

create table public.jobs (
  id            text primary key,
  name          text        not null,
  customer_name text        not null default '',
  address       text        not null default '',
  phone         text,
  salesperson   text        not null default '',
  team_leader   text        not null default '',
  job_number    text,
  notes         text,
  archived      boolean     not null default false,
  created_by    uuid        references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index jobs_name_idx on public.jobs using gin (to_tsvector('english', name));
create index jobs_updated_idx on public.jobs (updated_at desc);

create type public.visit_type       as enum ('site-visit', 'final-walkthrough', 'punch-recheck');
create type public.inspection_status as enum ('in-progress', 'completed');

create table public.inspections (
  id             text primary key,
  job_id         text        not null references public.jobs (id) on delete cascade,
  template_id    text        references public.templates (id) on delete set null,
  -- Frozen copy of the checklist as it stood when this inspection began:
  -- {templateId, templateName, templateVersion, infoFields, sections, capturedAt}
  snapshot       jsonb       not null,
  visit_type     public.visit_type        not null,
  status         public.inspection_status not null default 'in-progress',
  info           jsonb       not null default '{}'::jsonb,
  responses      jsonb       not null default '{}'::jsonb,
  summary_notes  text,
  inspector_sig  jsonb,
  customer_sig   jsonb,
  created_by     uuid        references public.profiles (id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  completed_at   timestamptz
);

create index inspections_job_idx       on public.inspections (job_id);
create index inspections_status_idx    on public.inspections (status, completed_at desc);
create index inspections_created_by_idx on public.inspections (created_by);

-- Photo bytes live in Storage; this table is the index that ties a file to the
-- question it documents.
create table public.photos (
  id            text primary key,
  inspection_id text        not null references public.inspections (id) on delete cascade,
  question_id   text        not null,
  storage_path  text        not null,
  caption       text,
  created_by    uuid        references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now()
);

create index photos_inspection_idx on public.photos (inspection_id);

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_touch      before update on public.profiles      for each row execute function public.touch_updated_at();
create trigger templates_touch     before update on public.templates     for each row execute function public.touch_updated_at();
create trigger shared_config_touch before update on public.shared_config for each row execute function public.touch_updated_at();
create trigger jobs_touch          before update on public.jobs          for each row execute function public.touch_updated_at();
create trigger inspections_touch   before update on public.inspections   for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

alter table public.profiles      enable row level security;
alter table public.templates     enable row level security;
alter table public.shared_config enable row level security;
alter table public.jobs          enable row level security;
alter table public.inspections   enable row level security;
alter table public.photos        enable row level security;

-- Profiles: everyone signed in can see the roster (needed to show who inspected
-- what). Only admins change roles; nobody edits their own role.
create policy profiles_select on public.profiles
  for select to authenticated using (true);

create policy profiles_update_self on public.profiles
  for update to authenticated
  using  (id = (select auth.uid()))
  with check (id = (select auth.uid()) and role = (select role from public.profiles where id = (select auth.uid())));

create policy profiles_admin_all on public.profiles
  for all to authenticated
  using ((select public.current_role_is_admin()))
  with check ((select public.current_role_is_admin()));

-- Templates: everyone reads (inspectors need them to run checklists),
-- only admins author.
create policy templates_select on public.templates
  for select to authenticated using (true);

create policy templates_admin_write on public.templates
  for all to authenticated
  using ((select public.current_role_is_admin()))
  with check ((select public.current_role_is_admin()));

create policy shared_select on public.shared_config
  for select to authenticated using (true);

create policy shared_admin_write on public.shared_config
  for all to authenticated
  using ((select public.current_role_is_admin()))
  with check ((select public.current_role_is_admin()));

-- Jobs: any signed-in user reads and creates; admins delete.
create policy jobs_select on public.jobs
  for select to authenticated using (true);

create policy jobs_insert on public.jobs
  for insert to authenticated with check (created_by = (select auth.uid()));

create policy jobs_update on public.jobs
  for update to authenticated using (true) with check (true);

create policy jobs_admin_delete on public.jobs
  for delete to authenticated using ((select public.current_role_is_admin()));

-- Inspections: everyone reads every report — recalling a past walkthrough is a
-- core inspector need. Writes are limited to the author until sign-off; after
-- that only an admin can reopen or amend the record.
create policy inspections_select on public.inspections
  for select to authenticated using (true);

create policy inspections_insert on public.inspections
  for insert to authenticated with check (created_by = (select auth.uid()));

create policy inspections_update_own_open on public.inspections
  for update to authenticated
  using (created_by = (select auth.uid()) and status = 'in-progress')
  with check (created_by = (select auth.uid()));

create policy inspections_admin_write on public.inspections
  for all to authenticated
  using ((select public.current_role_is_admin()))
  with check ((select public.current_role_is_admin()));

-- Photos follow their inspection.
create policy photos_select on public.photos
  for select to authenticated using (true);

create policy photos_insert on public.photos
  for insert to authenticated with check (created_by = (select auth.uid()));

create policy photos_delete_own on public.photos
  for delete to authenticated
  using (
    created_by = (select auth.uid())
    and exists (
      select 1 from public.inspections i
      where i.id = inspection_id and i.status = 'in-progress'
    )
  );

create policy photos_admin_write on public.photos
  for all to authenticated
  using ((select public.current_role_is_admin()))
  with check ((select public.current_role_is_admin()));

-- ---------------------------------------------------------------------------
-- Storage: inspection photos
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('inspection-photos', 'inspection-photos', false, 10485760, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

-- Objects are keyed <inspection_id>/<photo_id>.jpg. The bucket is private;
-- the app reads through signed URLs.
create policy photos_storage_read on storage.objects
  for select to authenticated
  using (bucket_id = 'inspection-photos');

create policy photos_storage_write on storage.objects
  for insert to authenticated
  with check (bucket_id = 'inspection-photos' and owner = (select auth.uid()));

create policy photos_storage_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'inspection-photos'
    and (owner = (select auth.uid()) or (select public.current_role_is_admin()))
  );

-- ---------------------------------------------------------------------------
-- Office summary — one row per inspection, for a dashboard or a Sheets mirror
-- ---------------------------------------------------------------------------

create view public.inspection_summary
with (security_invoker = true)
as
select
  i.id,
  j.name          as job_name,
  j.customer_name,
  j.address,
  j.salesperson,
  j.team_leader,
  i.snapshot ->> 'templateName' as checklist,
  i.visit_type,
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
join public.jobs j on j.id = i.job_id;
