/**
 * sweep-photos — deletes files in the photo bucket that no row points at.
 *
 * Runs on a schedule with the service key. What it will and will not delete is
 * decided entirely in `sweep.ts`, which is a pure function precisely because
 * this is the only code in QC2GO capable of destroying evidence.
 *
 * Deploy:  supabase functions deploy sweep-photos
 * Schedule (daily, 04:00 UTC), from the SQL editor:
 *
 *   select cron.schedule(
 *     'sweep-photos', '0 4 * * *',
 *     $$select net.http_post(
 *         url     := '<project-url>/functions/v1/sweep-photos',
 *         headers := jsonb_build_object(
 *           'Authorization', 'Bearer ' || current_setting('app.service_role_key'),
 *           'Content-Type',  'application/json'),
 *         body    := '{}'::jsonb) $$);
 *
 * POST `{"dryRun": true}` to see what it would collect without deleting
 * anything. Worth doing first on any deployment that has been running a while.
 */
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { decideSweep, type StorageObject } from './sweep.ts';

const BUCKET = 'inspection-photos';
const PAGE = 1000;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

type Client = ReturnType<typeof createClient>;

/**
 * Every object in the bucket, walked prefix by prefix.
 *
 * Storage `list` is per-directory rather than recursive, and photo paths are
 * `<org>/<inspection>/<photo>.jpg` — so this descends three levels rather than
 * asking for a flat listing that the API does not offer.
 */
async function listAll(client: Client, prefix = '', depth = 0): Promise<StorageObject[]> {
  if (depth > 3) return [];
  const found: StorageObject[] = [];

  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await client.storage
      .from(BUCKET)
      .list(prefix, { limit: PAGE, offset });
    if (error) throw new Error(`listing ${prefix || '/'}: ${error.message}`);
    if (!data || data.length === 0) break;

    for (const entry of data) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      // A folder comes back with no id; a file always has one.
      if (entry.id === null || entry.id === undefined) {
        found.push(...(await listAll(client, path, depth + 1)));
      } else {
        found.push({ path, createdAt: entry.created_at ?? new Date().toISOString() });
      }
    }

    if (data.length < PAGE) break;
  }

  return found;
}

Deno.serve(async (request: Request) => {
  if (request.method !== 'POST') return json({ error: 'Use POST.' }, 405);

  let body: { dryRun?: unknown } = {};
  try {
    body = await request.json();
  } catch {
    // An empty body is the ordinary scheduled case.
  }
  const dryRun = body.dryRun === true;

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  );

  let objects: StorageObject[];
  try {
    objects = await listAll(admin);
  } catch (error) {
    return json({ error: `Could not list the bucket: ${(error as Error).message}` }, 502);
  }

  /*
   * Every referenced path, read in one pass before anything is decided.
   *
   * A failure here has to stay a failure rather than becoming an empty set: the
   * difference between "no rows reference these files" and "we could not find
   * out" is the difference between a tidy-up and deleting the company's
   * photographs. `decideSweep` refuses on `ok: false`, so this cannot degrade
   * quietly.
   */
  const paths = new Set<string>();
  let known: Parameters<typeof decideSweep>[0]['known'] = { ok: true, paths };
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin
      .from('photos')
      .select('storage_path')
      .not('storage_path', 'is', null)
      .range(from, from + PAGE - 1);

    if (error) {
      known = { ok: false, reason: error.message };
      break;
    }
    for (const row of data ?? []) if (row.storage_path) paths.add(row.storage_path as string);
    if (!data || data.length < PAGE) break;
  }

  const decision = decideSweep({ objects, known, now: new Date() });

  if (decision.refused) {
    // A refusal is a 200 with a reason rather than an error: the run did its
    // job, which today was to decline. Something has to be able to see it.
    return json({ swept: 0, scanned: objects.length, ...decision });
  }

  if (!dryRun && decision.collect.length > 0) {
    const { error } = await admin.storage.from(BUCKET).remove(decision.collect);
    if (error) return json({ error: `Could not delete: ${error.message}` }, 502);
  }

  return json({
    scanned: objects.length,
    swept: dryRun ? 0 : decision.collect.length,
    wouldSweep: dryRun ? decision.collect.length : undefined,
    dryRun,
    kept: decision.kept,
    // Named rather than counted: a sweep that deleted the wrong thing has to
    // leave enough behind to say what it was.
    collected: decision.collect,
  });
});
