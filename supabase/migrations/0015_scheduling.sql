-- Scheduling for the two Edge Functions that nobody calls by hand.
--
-- `deliver-webhooks` drains a queue and `sweep-photos` collects orphaned files.
-- Both were written to be run on a timer, and until something runs them they
-- are deployed code that never executes — which looks exactly like a feature
-- that does not work. This is the timer.
--
-- ## Why every statement here is guarded
--
-- `npm run check:migrations` replays every file in this directory against a
-- plain PostgreSQL 16 to prove the tenancy boundary from an empty database.
-- `pg_cron`, `pg_net` and Supabase's Vault do not exist there, and a migration
-- that assumed them would turn that entire suite red for a reason that has
-- nothing to do with what it tests. So each step asks whether it is on a
-- platform that offers it, and does nothing where it is not.
--
-- ## Why the credentials are not in this file
--
-- A cron job has to authenticate to call a function, and the service-role key
-- bypasses row-level security entirely — it must never be committed. It is read
-- from Vault at call time instead, along with the project's functions URL,
-- which differs per deployment.
--
-- Both jobs are written so that a missing secret means they do nothing rather
-- than failing every minute against a null header. Set the two secrets and they
-- start working on their own:
--
--   select vault.create_secret('<service-role key>', 'qc2go_service_role_key');
--   select vault.create_secret('https://<ref>.supabase.co/functions/v1',
--                              'qc2go_functions_url');

do $$
declare
  has_cron boolean := exists (select 1 from pg_available_extensions where name = 'pg_cron');
  has_net  boolean := exists (select 1 from pg_available_extensions where name = 'pg_net');
  has_vault boolean;
begin
  if not (has_cron and has_net) then
    raise notice 'pg_cron/pg_net not available here — skipping scheduling.';
    return;
  end if;

  execute 'create extension if not exists pg_cron';
  -- Supabase packages pg_net with its schema pinned to `net`, and that is
  -- where the job bodies below look for it. A `with schema` clause here is
  -- silently ignored, which is a good way to schedule two jobs that fail
  -- every minute against a function that does not exist.
  execute 'create extension if not exists pg_net';

  has_vault := exists (select 1 from information_schema.tables
                       where table_schema = 'vault' and table_name = 'decrypted_secrets');
  if not has_vault then
    raise notice 'Vault not available here — extensions enabled, jobs not scheduled.';
    return;
  end if;

  -- Replacing rather than adding: re-running this file must not leave two jobs
  -- posting the same queue, which would double every delivery.
  perform cron.unschedule(jobname)
  from cron.job
  where jobname in ('qc2go-deliver-webhooks', 'qc2go-sweep-photos');

  -- Every minute. A webhook is how somebody else finds out an inspection was
  -- signed, and an hour of lag makes it a report rather than a notification.
  -- The function is idempotent — a delivered row is never selected again — so
  -- an overlapping run costs nothing.
  perform cron.schedule(
    'qc2go-deliver-webhooks',
    '* * * * *',
    $job$
    select net.http_post(
      url     := (select decrypted_secret from vault.decrypted_secrets
                  where name = 'qc2go_functions_url') || '/deliver-webhooks',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets
                                       where name = 'qc2go_service_role_key'),
        'Content-Type', 'application/json'),
      body    := '{}'::jsonb)
    where exists (select 1 from vault.decrypted_secrets where name = 'qc2go_service_role_key')
      and exists (select 1 from vault.decrypted_secrets where name = 'qc2go_functions_url');
    $job$);

  -- Daily, at four in the morning UTC. Nothing about an orphaned file is
  -- urgent — it has already been sitting there for at least seven days by the
  -- time this function will touch it — and a sweep is the one job in the
  -- system that deletes evidence, so it runs when nobody is uploading.
  perform cron.schedule(
    'qc2go-sweep-photos',
    '0 4 * * *',
    $job$
    select net.http_post(
      url     := (select decrypted_secret from vault.decrypted_secrets
                  where name = 'qc2go_functions_url') || '/sweep-photos',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets
                                       where name = 'qc2go_service_role_key'),
        'Content-Type', 'application/json'),
      body    := '{}'::jsonb)
    where exists (select 1 from vault.decrypted_secrets where name = 'qc2go_service_role_key')
      and exists (select 1 from vault.decrypted_secrets where name = 'qc2go_functions_url');
    $job$);
end
$$;
