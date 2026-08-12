-- ---------------------------------------------------------------------------
-- QC2GO — the audit ledger
--
-- A completed inspection is read-only in the app and the server refuses edits to
-- one from anybody but an admin. But "Reopen for editing" took no reason and
-- wrote nothing anywhere, so a signed QC record could be unlocked and amended
-- with no trace of who did it or why. That is the difference between a record
-- and a document somebody keeps.
--
-- Two halves, because this app works offline:
--
--   1. The reason is captured on the inspection itself (`reopenings`), so it can
--      be written in a crawlspace with no signal, travels with the record
--      through the ordinary sync, and shows on the report wherever it is read.
--   2. A trigger writes an append-only ledger row when the change reaches the
--      server. That half cannot be forged or suppressed by a device — same
--      shape as the tombstones in 0003: `security definer`, and no insert
--      policy for clients at all.
--
-- The client half is convenient and the server half is the evidence.
-- ---------------------------------------------------------------------------

create table public.audit_log (
  id         bigint      generated always as identity primary key,
  org_id     uuid        not null references public.organizations (id) on delete cascade,
  -- Who did it. Kept even if the account is later deleted — an audit row that
  -- forgets its actor is not worth writing.
  actor      uuid,
  actor_email text,
  entity     text        not null,
  entity_id  text        not null,
  action     text        not null,
  reason     text,
  -- Room for whatever a particular action needs to say, without a migration
  -- every time something new becomes worth recording.
  details    jsonb       not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index audit_log_org_idx    on public.audit_log (org_id, created_at desc);
create index audit_log_entity_idx on public.audit_log (org_id, entity, entity_id);

-- ---------------------------------------------------------------------------
-- Reopenings, on the record itself
--
-- An array rather than a single field: an inspection can be reopened more than
-- once, and the second time is exactly when the first one matters.
-- ---------------------------------------------------------------------------

alter table public.inspections
  add column reopenings jsonb not null default '[]'::jsonb;

comment on column public.inspections.reopenings is
  'Append-only on the client: [{reason, at, by}]. The trigger below copies each '
  'new entry into audit_log, which is where it cannot be edited away.';

-- ---------------------------------------------------------------------------
-- The trigger
--
-- Fires when a signed inspection goes back to in-progress. Reads the reason off
-- the newest entry in `reopenings` rather than taking it as an argument, so the
-- ledger says what the record says.
-- ---------------------------------------------------------------------------

create or replace function public.record_reopen()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
declare
  latest jsonb;
begin
  if old.status = 'completed' and new.status = 'in-progress' then
    latest := new.reopenings -> -1;

    insert into public.audit_log (org_id, actor, actor_email, entity, entity_id, action, reason, details)
    values (
      new.org_id,
      (select auth.uid()),
      (select email from public.profiles where id = (select auth.uid())),
      'inspection',
      new.id,
      'reopen',
      -- Null when a device somehow reopened without one. Recording the event
      -- with no reason is far better than not recording it.
      latest ->> 'reason',
      jsonb_build_object(
        'completed_at', old.completed_at,
        'reopened_at', coalesce(latest ->> 'at', now()::text)
      )
    );
  end if;

  return new;
end;
$$;

create trigger inspections_record_reopen
  after update on public.inspections
  for each row execute function public.record_reopen();

-- ---------------------------------------------------------------------------
-- Row level security
--
-- Readable inside the company it belongs to. Not writable by anybody: there is
-- deliberately no insert, update or delete policy, so the only thing that can
-- add a row is the `security definer` trigger above, and nothing at all can
-- change or remove one. That is what makes it a ledger rather than a table.
-- ---------------------------------------------------------------------------

alter table public.audit_log enable row level security;

create policy audit_log_select on public.audit_log
  for select to authenticated
  using (org_id = (select public.current_org_id()));
