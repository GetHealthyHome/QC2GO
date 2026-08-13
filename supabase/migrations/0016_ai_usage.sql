-- A ceiling on what the AI features can cost a company in a day.
--
-- Every other endpoint in QC2GO costs the same whether it is called ten times
-- or ten thousand: the database is already paid for. A model call is not, and
-- the button that makes one sits on a text field that somebody can press as
-- often as they like. Without a counter, the first thing anybody learns about
-- a stuck retry loop is the invoice.
--
-- The limit is per company per day rather than per person, because the bill is
-- per company and a shared crew account would otherwise divide by one.
--
-- ## Why the limit is not a parameter
--
-- This function is reachable over PostgREST by anybody signed in. If it took
-- the limit as an argument, the client that is being metered would be the one
-- choosing the meter. It is a constant here, where changing it takes a
-- migration.

create table if not exists public.ai_usage (
  org_id uuid not null references public.organizations (id) on delete cascade,
  -- UTC, deliberately. A day boundary that follows the caller's clock is a day
  -- boundary that can be crossed twice by changing a phone's time zone.
  day date not null default ((now() at time zone 'utc')::date),
  kind text not null default 'scribe',
  calls integer not null default 0,
  primary key (org_id, day, kind)
);

alter table public.ai_usage enable row level security;

-- Readable within the company, so Settings can show what has been used. Not
-- writable by anyone: the only thing that increments it is the function below,
-- which runs as its owner.
drop policy if exists "ai usage is readable within the company" on public.ai_usage;
create policy "ai usage is readable within the company"
  on public.ai_usage for select
  using (org_id = public.current_org_id());

/**
 * Claims one call against today's allowance, returning whether it was granted.
 *
 * The claim and the check are one statement on purpose. Reading the count and
 * then incrementing it lets two calls that arrive together both see the same
 * number and both proceed — which is exactly the shape of a retry storm, the
 * thing this is here to stop.
 */
create or replace function public.ai_take(p_kind text default 'scribe')
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  -- Generous for a working day of ordinary use, low enough that a loop is
  -- capped at a few dollars rather than discovered later.
  daily_limit constant integer := 200;
  org uuid := public.current_org_id();
  granted boolean;
begin
  -- Local-mode data and accounts not yet in a company have nothing to meter,
  -- and nothing to charge either.
  if org is null then
    return false;
  end if;

  insert into public.ai_usage (org_id, day, kind, calls)
  values (org, (now() at time zone 'utc')::date, p_kind, 1)
  on conflict (org_id, day, kind) do update
    set calls = public.ai_usage.calls + 1
    -- No row comes back when this fails, which is the refusal.
    where public.ai_usage.calls < daily_limit
  returning true into granted;

  return coalesce(granted, false);
end;
$$;

revoke all on function public.ai_take(text) from public;
grant execute on function public.ai_take(text) to authenticated;
