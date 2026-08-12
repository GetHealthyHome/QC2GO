-- ---------------------------------------------------------------------------
-- QC2GO — organizations
--
-- Until now the schema assumed one company. Every read policy was
-- `using (true)`: any signed-in person could see every customer, every
-- inspection, every photo and the whole user roster. That is correct for one
-- company and catastrophic for two.
--
-- This migration introduces the tenancy boundary. One organization per company,
-- one organization per user (`profiles.org_id`), and every policy in the
-- database narrowed from "is this person signed in?" to "is this row theirs?".
--
-- The boundary is a single scalar comparison on purpose. A join in a policy is
-- a place for a mistake to hide, and a mistake here is one company reading
-- another's inspection records. `current_org_id()` is the only thing any policy
-- needs to know.
--
-- Requires PostgreSQL 13+ for `gen_random_uuid()` via pgcrypto, already enabled
-- in 0001.
-- ---------------------------------------------------------------------------

-- The summary view reads columns and tables that change below.
drop view if exists public.inspection_summary;

-- ---------------------------------------------------------------------------
-- Organizations
-- ---------------------------------------------------------------------------

create table public.organizations (
  id         uuid        primary key default gen_random_uuid(),
  name       text        not null,
  -- Stable, human-readable handle. Used in support conversations and reserved
  -- for per-company URLs later.
  slug       text        not null unique,
  active     boolean     not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger organizations_touch before update on public.organizations
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Roles
--
-- `owner` joins the existing two. An owner is the person who answers for the
-- company: they manage members and invitations, which an admin cannot. Admin
-- keeps its existing meaning — authoring checklists and amending signed records.
--
-- `alter type ... add value` cannot be used in the same transaction that adds
-- it, and these policies use the new value immediately, so the type is replaced
-- rather than extended.
-- ---------------------------------------------------------------------------

create type public.user_role_next as enum ('owner', 'admin', 'inspector');

-- A column cannot change type while a policy reads it, and two of these read
-- `role`. They are dropped here and rebuilt, org-scoped, further down.
drop policy profiles_select      on public.profiles;
drop policy profiles_update_self on public.profiles;
drop policy profiles_admin_all   on public.profiles;

alter table public.profiles alter column role drop default;
alter table public.profiles
  alter column role type public.user_role_next using role::text::public.user_role_next;
alter table public.profiles alter column role set default 'inspector';

drop type public.user_role;
alter type public.user_role_next rename to user_role;

-- ---------------------------------------------------------------------------
-- Org membership
--
-- Deliberately nullable. Somebody who reaches an account without an invitation
-- belongs to no company, and every policy below compares against their org id —
-- which is null, so every comparison is null, so they see nothing. The failure
-- mode of an unrecognised account is an empty app, not somebody else's data.
-- ---------------------------------------------------------------------------

alter table public.profiles
  add column org_id uuid references public.organizations (id) on delete cascade;

create index profiles_org_idx on public.profiles (org_id);

-- Reads the caller's organization with definer rights, so a policy on
-- `profiles` can call it without recursing into itself.
create or replace function public.current_org_id()
returns uuid
language sql
stable
security definer set search_path = ''
as $$
  select org_id from public.profiles where id = (select auth.uid());
$$;

-- Owners can do everything an admin can. Every existing `current_role_is_admin`
-- call site keeps working and now means "admin or above".
create or replace function public.current_role_is_admin()
returns boolean
language sql
stable
security definer set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and role in ('owner', 'admin')
  );
$$;

create or replace function public.current_role_is_owner()
returns boolean
language sql
stable
security definer set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and role = 'owner'
  );
$$;

-- ---------------------------------------------------------------------------
-- org_id on every tenant-owned table
--
-- Added nullable, backfilled, then pinned not-null. The default means the
-- client never has to send the column: a row inserted by a signed-in caller
-- belongs to that caller's company whether or not the app says so, and the
-- with-check policies below make sure it cannot say otherwise.
-- ---------------------------------------------------------------------------

alter table public.templates     add column org_id uuid references public.organizations (id) on delete cascade;
alter table public.shared_config add column org_id uuid references public.organizations (id) on delete cascade;
alter table public.customers     add column org_id uuid references public.organizations (id) on delete cascade;
alter table public.inspections   add column org_id uuid references public.organizations (id) on delete cascade;
alter table public.photos        add column org_id uuid references public.organizations (id) on delete cascade;
alter table public.tombstones    add column org_id uuid references public.organizations (id) on delete cascade;

-- ---------------------------------------------------------------------------
-- Backfill
--
-- Everything that exists today belongs to the company this app was built for.
-- Runs only when there is something to adopt, so a fresh project stays empty.
-- ---------------------------------------------------------------------------

do $$
declare
  home_org uuid;
begin
  if not exists (select 1 from public.profiles)
     and not exists (select 1 from public.customers)
     and not exists (select 1 from public.templates) then
    return;
  end if;

  insert into public.organizations (name, slug)
  values ('Get Healthy Home', 'get-healthy-home')
  returning id into home_org;

  update public.profiles      set org_id = home_org where org_id is null;
  update public.templates     set org_id = home_org where org_id is null;
  update public.shared_config set org_id = home_org where org_id is null;
  update public.customers     set org_id = home_org where org_id is null;
  update public.inspections   set org_id = home_org where org_id is null;
  update public.photos        set org_id = home_org where org_id is null;
  update public.tombstones    set org_id = home_org where org_id is null;

  -- A company needs somebody who can invite people into it. The longest-standing
  -- admin becomes the owner; if there are no admins at all, the first account does.
  update public.profiles set role = 'owner'
  where id = (
    select id from public.profiles
    order by (role = 'admin') desc, created_at asc
    limit 1
  );

  -- Photo objects move under an organization prefix to match the storage
  -- policies below. The rows that point at them move with them — a path updated
  -- in one place and not the other is an unreadable photo.
  update storage.objects
     set name = home_org::text || '/' || name
   where bucket_id = 'inspection-photos'
     and (storage.foldername(name))[1] <> home_org::text;

  update public.photos
     set storage_path = home_org::text || '/' || storage_path
   where storage_path not like home_org::text || '/%';
end $$;

alter table public.templates     alter column org_id set not null;
alter table public.shared_config alter column org_id set not null;
alter table public.customers     alter column org_id set not null;
alter table public.inspections   alter column org_id set not null;
alter table public.photos        alter column org_id set not null;
alter table public.tombstones    alter column org_id set not null;

alter table public.templates     alter column org_id set default public.current_org_id();
alter table public.shared_config alter column org_id set default public.current_org_id();
alter table public.customers     alter column org_id set default public.current_org_id();
alter table public.inspections   alter column org_id set default public.current_org_id();
alter table public.photos        alter column org_id set default public.current_org_id();

create index templates_org_idx   on public.templates   (org_id);
create index customers_org_idx   on public.customers   (org_id);
create index inspections_org_idx on public.inspections (org_id);
create index photos_org_idx      on public.photos      (org_id);
create index tombstones_org_idx  on public.tombstones  (org_id, deleted_at desc);

-- ---------------------------------------------------------------------------
-- Checklist ids are only unique inside a company
--
-- The shipped checklists carry fixed ids from code — `home-performance`,
-- `quick-safety-audit`. Every company that installs the app seeds its own
-- editable copies under those same ids, so a global primary key means the
-- second company to sync gets a unique violation. Worse, 23505 is on the sync
-- engine's permanent-failure list, so the upload would be abandoned rather than
-- retried, and the company would silently have no checklists.
--
-- The key becomes (org_id, id): the same checklist id in two companies is two
-- different checklists, which is what it always meant.
-- ---------------------------------------------------------------------------

-- `inspections.template_id` loses its foreign key rather than growing into a
-- composite one. The reason is the same one already given for
-- `customers.template_ids` in 0002: an inspection freezes its own snapshot of
-- the checklist, so the id is a convenience link and not the source of truth.
-- The constraint was also doing active harm — the sync engine had to null the
-- column out whenever a checklist had not reached the server yet, purely to
-- stop inspections failing to upload behind it.
--
-- It goes first regardless: it is built on the primary key index that is about
-- to be replaced.
alter table public.inspections drop constraint inspections_template_id_fkey;

alter table public.templates drop constraint templates_pkey;
alter table public.templates add primary key (org_id, id);

-- ---------------------------------------------------------------------------
-- The shared config becomes one row per company
--
-- It was pinned to a single row by a `singleton` primary key. That pin is now
-- the organization.
-- ---------------------------------------------------------------------------

alter table public.shared_config drop constraint shared_config_pkey;
alter table public.shared_config drop column singleton;
alter table public.shared_config add primary key (org_id);

-- ---------------------------------------------------------------------------
-- Invitations
--
-- How somebody joins a company. An owner creates the invitation; the person
-- signs up with that email and lands inside the company with the role they were
-- given. Nobody reaches an organization any other way — there is no self-serve
-- path that creates one, and an account with no invitation gets no org at all.
-- ---------------------------------------------------------------------------

create table public.invites (
  id          uuid        primary key default gen_random_uuid(),
  org_id      uuid        not null references public.organizations (id) on delete cascade
                            default public.current_org_id(),
  email       text        not null,
  role        public.user_role not null default 'inspector',
  invited_by  uuid        references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default now() + interval '14 days',
  accepted_at timestamptz,
  accepted_by uuid        references public.profiles (id) on delete set null
);

-- One live invitation per address, across every company. A person belongs to
-- one organization, so two companies inviting the same address is a conflict to
-- surface at invite time rather than a race to settle at signup.
create unique index invites_pending_email_idx
  on public.invites (lower(email)) where accepted_at is null;

create index invites_org_idx on public.invites (org_id, created_at desc);

-- Signup binds to the invitation: the new profile takes the organization and
-- the role from it, and the invitation is marked accepted in the same
-- statement. No invitation means no organization — the account exists and sees
-- nothing, which is the safe direction to fail in.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
declare
  invite public.invites;
begin
  select * into invite
    from public.invites
   where lower(email) = lower(new.email)
     and accepted_at is null
     and expires_at > now()
   order by created_at desc
   limit 1;

  insert into public.profiles (id, email, full_name, org_id, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    invite.org_id,
    coalesce(invite.role, 'inspector')
  );

  if invite.id is not null then
    update public.invites
       set accepted_at = now(), accepted_by = new.id
     where id = invite.id;
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Tombstones carry their organization
--
-- A tombstone is an id and nothing else, which was harmless when every id
-- belonged to the same company. Now it would tell one company the identifiers
-- of another's deleted records, so the marker records whose row it was. The
-- trigger reads it off the deleted row, which every tenant-owned table now has.
-- ---------------------------------------------------------------------------

create or replace function public.record_tombstone()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  insert into public.tombstones (org_id, entity, entity_id)
  values (old.org_id, tg_argv[0], old.id);
  return old;
end;
$$;

-- ---------------------------------------------------------------------------
-- Row level security, rewritten
--
-- Every policy that read `using (true)` now reads
-- `using (org_id = current_org_id())`. Dropped and recreated rather than
-- altered, so the whole set is visible in one place and reviewable as one thing.
-- ---------------------------------------------------------------------------

alter table public.organizations enable row level security;
alter table public.invites       enable row level security;

-- Organizations: members see their own company and nothing else. Only an owner
-- renames it. Creating one is deliberately not possible from the app.
create policy organizations_select on public.organizations
  for select to authenticated
  using (id = (select public.current_org_id()));

create policy organizations_owner_update on public.organizations
  for update to authenticated
  using (id = (select public.current_org_id()) and (select public.current_role_is_owner()))
  with check (id = (select public.current_org_id()));

-- Profiles: the roster is company-scoped. Everything else about it is unchanged
-- — nobody edits their own role, admins manage the rest. (Dropped above, where
-- the role column had to change type out from under them.)
create policy profiles_select on public.profiles
  for select to authenticated
  using (org_id = (select public.current_org_id()));

create policy profiles_update_self on public.profiles
  for update to authenticated
  using  (id = (select auth.uid()))
  with check (
    id = (select auth.uid())
    and role   = (select role   from public.profiles where id = (select auth.uid()))
    and org_id = (select public.current_org_id())
  );

-- An admin manages their own company's roster. The org_id check on both sides
-- stops an admin moving somebody into or out of another company.
create policy profiles_admin_all on public.profiles
  for all to authenticated
  using      (org_id = (select public.current_org_id()) and (select public.current_role_is_admin()))
  with check (org_id = (select public.current_org_id()) and (select public.current_role_is_admin()));

-- Invitations: an owner manages them, an admin can see who is outstanding.
create policy invites_select on public.invites
  for select to authenticated
  using (org_id = (select public.current_org_id()) and (select public.current_role_is_admin()));

create policy invites_owner_write on public.invites
  for all to authenticated
  using      (org_id = (select public.current_org_id()) and (select public.current_role_is_owner()))
  with check (org_id = (select public.current_org_id()) and (select public.current_role_is_owner()));

-- Templates.
drop policy templates_select      on public.templates;
drop policy templates_admin_write on public.templates;

create policy templates_select on public.templates
  for select to authenticated
  using (org_id = (select public.current_org_id()));

create policy templates_admin_write on public.templates
  for all to authenticated
  using      (org_id = (select public.current_org_id()) and (select public.current_role_is_admin()))
  with check (org_id = (select public.current_org_id()) and (select public.current_role_is_admin()));

-- Shared config.
drop policy shared_select      on public.shared_config;
drop policy shared_admin_write on public.shared_config;

create policy shared_select on public.shared_config
  for select to authenticated
  using (org_id = (select public.current_org_id()));

create policy shared_admin_write on public.shared_config
  for all to authenticated
  using      (org_id = (select public.current_org_id()) and (select public.current_role_is_admin()))
  with check (org_id = (select public.current_org_id()) and (select public.current_role_is_admin()));

-- Customers.
drop policy customers_select       on public.customers;
drop policy customers_insert       on public.customers;
drop policy customers_update       on public.customers;
drop policy customers_admin_delete on public.customers;

create policy customers_select on public.customers
  for select to authenticated
  using (org_id = (select public.current_org_id()));

create policy customers_insert on public.customers
  for insert to authenticated
  with check (org_id = (select public.current_org_id()) and created_by = (select auth.uid()));

create policy customers_update on public.customers
  for update to authenticated
  using      (org_id = (select public.current_org_id()))
  with check (org_id = (select public.current_org_id()));

create policy customers_admin_delete on public.customers
  for delete to authenticated
  using (org_id = (select public.current_org_id()) and (select public.current_role_is_admin()));

-- Inspections. Reads stay company-wide — recalling a colleague's past
-- walkthrough is a core need — and writes stay limited to the author until
-- sign-off, after which only an admin can amend the record.
drop policy inspections_select          on public.inspections;
drop policy inspections_insert          on public.inspections;
drop policy inspections_update_own_open on public.inspections;
drop policy inspections_admin_write     on public.inspections;

create policy inspections_select on public.inspections
  for select to authenticated
  using (org_id = (select public.current_org_id()));

create policy inspections_insert on public.inspections
  for insert to authenticated
  with check (org_id = (select public.current_org_id()) and created_by = (select auth.uid()));

create policy inspections_update_own_open on public.inspections
  for update to authenticated
  using (
    org_id = (select public.current_org_id())
    and created_by = (select auth.uid())
    and status = 'in-progress'
  )
  with check (org_id = (select public.current_org_id()) and created_by = (select auth.uid()));

create policy inspections_admin_write on public.inspections
  for all to authenticated
  using      (org_id = (select public.current_org_id()) and (select public.current_role_is_admin()))
  with check (org_id = (select public.current_org_id()) and (select public.current_role_is_admin()));

-- Photos.
drop policy photos_select      on public.photos;
drop policy photos_insert      on public.photos;
drop policy photos_delete_own  on public.photos;
drop policy photos_admin_write on public.photos;

create policy photos_select on public.photos
  for select to authenticated
  using (org_id = (select public.current_org_id()));

create policy photos_insert on public.photos
  for insert to authenticated
  with check (org_id = (select public.current_org_id()) and created_by = (select auth.uid()));

create policy photos_delete_own on public.photos
  for delete to authenticated
  using (
    org_id = (select public.current_org_id())
    and created_by = (select auth.uid())
    and exists (
      select 1 from public.inspections i
      where i.id = inspection_id and i.status = 'in-progress'
    )
  );

create policy photos_admin_write on public.photos
  for all to authenticated
  using      (org_id = (select public.current_org_id()) and (select public.current_role_is_admin()))
  with check (org_id = (select public.current_org_id()) and (select public.current_role_is_admin()));

-- Tombstones stay read-only to clients. There is still no insert policy: a
-- device reads the record of a delete and cannot forge one.
drop policy tombstones_select on public.tombstones;

create policy tombstones_select on public.tombstones
  for select to authenticated
  using (org_id = (select public.current_org_id()));

-- ---------------------------------------------------------------------------
-- Storage
--
-- Objects move from `<inspection_id>/<photo_id>.jpg` to
-- `<org_id>/<inspection_id>/<photo_id>.jpg`. The bucket had no tenancy at all:
-- the read policy admitted any signed-in caller to any object in it, so a photo
-- was one guessed path away from anybody with an account. The org prefix is
-- what the policy now checks.
-- ---------------------------------------------------------------------------

drop policy photos_storage_read   on storage.objects;
drop policy photos_storage_write  on storage.objects;
drop policy photos_storage_delete on storage.objects;

create policy photos_storage_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'inspection-photos'
    and (storage.foldername(name))[1] = (select public.current_org_id())::text
  );

create policy photos_storage_write on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'inspection-photos'
    and (storage.foldername(name))[1] = (select public.current_org_id())::text
    and owner = (select auth.uid())
  );

create policy photos_storage_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'inspection-photos'
    and (storage.foldername(name))[1] = (select public.current_org_id())::text
    and (owner = (select auth.uid()) or (select public.current_role_is_admin()))
  );

-- ---------------------------------------------------------------------------
-- Office summary — rebuilt with the organization on it
--
-- `security_invoker` means the view is filtered by the same policies as the
-- tables underneath, so a company reading it sees only its own inspections.
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
