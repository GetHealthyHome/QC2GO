-- ---------------------------------------------------------------------------
-- QC2GO — handing a finished report to somebody outside the company
--
-- Today a report leaves the app as a printed PDF or a JSON file. There is no
-- way to send a link — not to the homeowner, not to the utility running the
-- rebate, not to a general contractor. The TRD's third-party sharing has three
-- tiers; this is the one a customer would actually use, and the other two are
-- for a different kind of business than this.
--
-- The token is stored hashed, not in plaintext.
--
-- That is the decision worth understanding. A share token is a bearer
-- credential: whoever holds the link can read the report. If these rows are
-- ever read by somebody who should not have them — a leaked backup, an
-- over-broad policy, a support query gone wrong — plaintext tokens hand over
-- every live share at once. A SHA-256 of the token is useless to a reader and
-- exactly as useful to the function checking one, which is the same reasoning
-- applied to passwords everywhere else.
--
-- The consequence is that the link is shown once, when it is created, and
-- cannot be recovered afterwards. That is the right trade: a lost link is
-- replaced in two taps, and a leaked table is not.
-- ---------------------------------------------------------------------------

create table public.report_shares (
  id            uuid        primary key default gen_random_uuid(),
  org_id        uuid        not null references public.organizations (id) on delete cascade
                              default public.current_org_id(),
  inspection_id text        not null references public.inspections (id) on delete cascade,
  -- SHA-256 of the token, hex. Never the token itself.
  token_hash    text        not null unique,
  -- Optional second factor for a link that will travel over SMS or a shared
  -- inbox. Also hashed.
  passcode_hash text,
  expires_at    timestamptz not null,
  revoked_at    timestamptz,
  -- Who it was made for, so a list of live shares is readable by a human.
  recipient     text,
  view_count    integer     not null default 0,
  last_viewed_at timestamptz,
  created_by    uuid        references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now()
);

create index report_shares_org_idx on public.report_shares (org_id, created_at desc);
create index report_shares_inspection_idx on public.report_shares (inspection_id);

-- A share that never expires is a report published to the internet by accident.
alter table public.report_shares add constraint report_shares_expires
  check (expires_at > created_at);

-- ---------------------------------------------------------------------------
-- Row level security
--
-- Company-scoped like everything else. Anonymous readers never touch this
-- table: the Edge Function looks a token up with the service key, because an
-- anonymous caller has no company to be scoped to and giving one read access
-- here would mean giving it read access to every share.
-- ---------------------------------------------------------------------------

alter table public.report_shares enable row level security;

create policy report_shares_select on public.report_shares
  for select to authenticated
  using (org_id = (select public.current_org_id()));

create policy report_shares_insert on public.report_shares
  for insert to authenticated
  with check (org_id = (select public.current_org_id()) and created_by = (select auth.uid()));

-- Revoking is an update, and anybody in the company may do it: a link sent to
-- the wrong address is an emergency, and making somebody find an owner first is
-- how it stays live for another hour.
create policy report_shares_update on public.report_shares
  for update to authenticated
  using      (org_id = (select public.current_org_id()))
  with check (org_id = (select public.current_org_id()));

create policy report_shares_admin_delete on public.report_shares
  for delete to authenticated
  using (org_id = (select public.current_org_id()) and (select public.current_role_is_admin()));
