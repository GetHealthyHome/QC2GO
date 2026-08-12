-- ---------------------------------------------------------------------------
-- QC2GO — telling somebody else an inspection finished
--
-- The hook everything downstream hangs off: a CRM that wants the result, a
-- Slack channel that wants the failures, a utility's rebate system that wants
-- the evidence. Until now the only way out of QC2GO was somebody printing a PDF.
--
-- Two things shape this.
--
-- **The payload is built here, at the moment of completion, and stored.** Not
-- assembled later from whatever the record says by then. An inspection can be
-- reopened and amended; the webhook has to describe what was true when it fired,
-- and a delivery that retries an hour later must send the same body it was going
-- to send an hour ago.
--
-- **Deliveries are a queue, not a fire-and-forget.** The receiving end will be
-- down sometimes, and an event that is lost because somebody's server was
-- restarting is worse than no integration at all. Same shape as the client's
-- own sync outbox: enqueue, attempt, back off, keep the failure visible.
-- ---------------------------------------------------------------------------

create table public.webhook_endpoints (
  id          uuid        primary key default gen_random_uuid(),
  org_id      uuid        not null references public.organizations (id) on delete cascade
                            default public.current_org_id(),
  url         text        not null,
  -- Shared with the receiver so it can verify the HMAC signature on the body
  -- and know the request really came from here.
  secret      text        not null,
  -- Which events this endpoint wants. One today; the column exists so adding
  -- `inspection.created` or `task.flagged` is not another migration.
  events      text[]      not null default array['inspection.completed'],
  active      boolean     not null default true,
  description text,
  created_by  uuid        references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.webhook_endpoints add constraint webhook_endpoints_url_is_https
  check (url like 'https://%');

create index webhook_endpoints_org_idx on public.webhook_endpoints (org_id) where active;

create trigger webhook_endpoints_touch before update on public.webhook_endpoints
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- The queue
-- ---------------------------------------------------------------------------

create table public.webhook_deliveries (
  id           bigint      generated always as identity primary key,
  org_id       uuid        not null references public.organizations (id) on delete cascade,
  endpoint_id  uuid        not null references public.webhook_endpoints (id) on delete cascade,
  event        text        not null,
  -- Frozen at enqueue. See the note at the top: a retry an hour later must send
  -- the body it was always going to send.
  payload      jsonb       not null,
  attempts     integer     not null default 0,
  -- Exponential backoff lives in this column rather than in the worker, so a
  -- worker restarting does not re-send everything at once.
  next_attempt_at timestamptz not null default now(),
  delivered_at timestamptz,
  last_status  integer,
  last_error   text,
  created_at   timestamptz not null default now()
);

create index webhook_deliveries_pending_idx
  on public.webhook_deliveries (next_attempt_at)
  where delivered_at is null;

create index webhook_deliveries_org_idx
  on public.webhook_deliveries (org_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Building the payload
--
-- Deliberately the TRD's §5.2 shape rather than this app's own field names.
-- Whoever receives this is integrating against a documented contract, and the
-- moment it is easier to send our internal shape is the moment the contract
-- starts drifting.
-- ---------------------------------------------------------------------------

create or replace function public.inspection_completed_payload(inspection public.inspections)
returns jsonb
language sql
stable
security definer set search_path = ''
as $$
  select jsonb_build_object(
    'event', 'inspection.completed',
    'timestamp', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'data', jsonb_build_object(
      'inspection_id',   inspection.id,
      'template_id',     coalesce(inspection.template_id, inspection.snapshot ->> 'templateId'),
      'template_version', inspection.snapshot ->> 'templateVersion',
      'organization_id', inspection.org_id,
      'site_id',         inspection.customer_id,
      'site', (
        select jsonb_build_object('customer_name', c.customer_name, 'address', c.address)
          from public.customers c where c.id = inspection.customer_id
      ),
      'visit_type', inspection.visit_type,
      'visit_date', inspection.visit_date,
      'inspector', jsonb_build_object(
        'user_id', inspection.created_by,
        'name',    inspection.info ->> 'inspector'
      ),
      'summary', jsonb_build_object(
        'overall_score',      inspection.overall_score,
        'pass_fail_status',   inspection.pass_fail_status,
        'total_deficiencies', inspection.total_deficiencies
      )
    )
  );
$$;

-- ---------------------------------------------------------------------------
-- The trigger
--
-- Fires on the same transition the audit ledger watches, in the other
-- direction: in-progress to completed. Nothing is enqueued when a company has
-- no endpoints, so a queue that fills up is a company that asked for it.
-- ---------------------------------------------------------------------------

create or replace function public.enqueue_inspection_completed()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
declare
  body jsonb;
begin
  if new.status = 'completed' and (old.status is distinct from 'completed') then
    body := public.inspection_completed_payload(new);

    insert into public.webhook_deliveries (org_id, endpoint_id, event, payload)
    select new.org_id, e.id, 'inspection.completed', body
      from public.webhook_endpoints e
     where e.org_id = new.org_id
       and e.active
       and 'inspection.completed' = any (e.events);
  end if;

  return new;
end;
$$;

create trigger inspections_enqueue_completed
  after update on public.inspections
  for each row execute function public.enqueue_inspection_completed();

-- An inspection can also arrive already completed: the app is offline-first, so
-- a whole visit can be walked and signed with no signal and reach the server in
-- one insert.
create or replace function public.enqueue_inspection_completed_insert()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
declare
  body jsonb;
begin
  if new.status = 'completed' then
    body := public.inspection_completed_payload(new);

    insert into public.webhook_deliveries (org_id, endpoint_id, event, payload)
    select new.org_id, e.id, 'inspection.completed', body
      from public.webhook_endpoints e
     where e.org_id = new.org_id
       and e.active
       and 'inspection.completed' = any (e.events);
  end if;

  return new;
end;
$$;

create trigger inspections_enqueue_completed_insert
  after insert on public.inspections
  for each row execute function public.enqueue_inspection_completed_insert();

-- ---------------------------------------------------------------------------
-- Row level security
--
-- Endpoints are an owner's business — the secret is a credential, and pointing
-- QC2GO at a URL is a decision about where a company's data goes. Deliveries
-- are readable by admins so a failing integration can be diagnosed, and
-- writable by nobody: the trigger enqueues them and the worker (which runs with
-- the service key) updates them.
-- ---------------------------------------------------------------------------

alter table public.webhook_endpoints  enable row level security;
alter table public.webhook_deliveries enable row level security;

create policy webhook_endpoints_owner_all on public.webhook_endpoints
  for all to authenticated
  using      (org_id = (select public.current_org_id()) and (select public.current_role_is_owner()))
  with check (org_id = (select public.current_org_id()) and (select public.current_role_is_owner()));

create policy webhook_deliveries_select on public.webhook_deliveries
  for select to authenticated
  using (org_id = (select public.current_org_id()) and (select public.current_role_is_admin()));
