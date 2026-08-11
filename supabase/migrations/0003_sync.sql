-- ---------------------------------------------------------------------------
-- QC2GO — what the sync layer needs from the database
--
-- Three gaps, found while wiring the client up to these tables:
--
--   1. `shared_config` had nowhere to keep the salesperson and team-leader pick
--      lists, so they could not round-trip.
--   2. A delete on one device had no way of reaching another. Rows just vanish,
--      and a puller that only asks "what changed since?" never learns about it.
--   3. Pulling by `updated_at` had no index behind it on most tables.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- Admin-maintained pick lists
--
-- These live on the shared config rather than in a table of their own: they are
-- plain strings the office maintains, not people records with an identity.
-- ---------------------------------------------------------------------------

alter table public.shared_config add column salespeople  text[] not null default '{}'::text[];
alter table public.shared_config add column team_leaders text[] not null default '{}'::text[];

-- ---------------------------------------------------------------------------
-- Tombstones
--
-- A pull asks "what changed since I last looked?". Deleted rows cannot answer,
-- so every delete leaves a marker behind that a device can read on its way past.
--
-- Recorded by trigger rather than by the client, which means cascades are caught
-- too: deleting a customer takes its inspections and photos with it, and each of
-- those row-level deletes leaves its own marker.
-- ---------------------------------------------------------------------------

create table public.tombstones (
  id         bigint generated always as identity primary key,
  entity     text        not null check (entity in ('customer', 'inspection', 'photo', 'template')),
  entity_id  text        not null,
  deleted_at timestamptz not null default now()
);

create index tombstones_deleted_idx on public.tombstones (deleted_at desc);

-- `security definer` so the marker is written by the trigger and not by the
-- caller. There is deliberately no insert policy below: a device can read the
-- record of a delete but cannot forge one and make another device drop data.
create or replace function public.record_tombstone()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.tombstones (entity, entity_id) values (tg_argv[0], old.id);
  return old;
end;
$$;

create trigger customers_tombstone   after delete on public.customers
  for each row execute function public.record_tombstone('customer');
create trigger inspections_tombstone after delete on public.inspections
  for each row execute function public.record_tombstone('inspection');
create trigger photos_tombstone      after delete on public.photos
  for each row execute function public.record_tombstone('photo');
create trigger templates_tombstone   after delete on public.templates
  for each row execute function public.record_tombstone('template');

alter table public.tombstones enable row level security;

create policy tombstones_select on public.tombstones
  for select to authenticated using (true);

-- ---------------------------------------------------------------------------
-- Indexes the pull actually uses
--
-- Every pull is "where updated_at > my watermark". `customers_updated_idx` came
-- across from 0001; the rest were missing. Photos are immutable once written, so
-- they are pulled by `created_at` instead.
-- ---------------------------------------------------------------------------

create index inspections_updated_idx on public.inspections (updated_at desc);
create index templates_updated_idx   on public.templates   (updated_at desc);
create index photos_created_idx      on public.photos      (created_at desc);
