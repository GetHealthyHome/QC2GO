/**
 * deliver-webhooks — drains the delivery queue.
 *
 * Runs with the `service_role` key, but unlike `invite-user` it takes no input
 * from a caller and makes no decision about who anything belongs to: it reads
 * rows the database already wrote and posts them where those rows say. The
 * queue is the authority, so there is nothing here for a request body to
 * influence.
 *
 * Schedule it every minute — see `supabase/README.md`. Invoking it by hand is
 * also fine; it is idempotent, because a delivered row is never selected again.
 */
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { MAX_ATTEMPTS, isDelivered, isWorthRetrying, nextAttemptAfter } from './schedule.ts';
import { blockedReason } from './ssrf.ts';
import { refuseUnlessCron } from '../_shared/cron.ts';

/** Enough to clear a backlog, few enough that one run cannot hang for minutes. */
const BATCH = 25;
const TIMEOUT_MS = 10_000;

/** HMAC-SHA256 of the exact bytes sent, so the receiver can verify the sender. */
async function sign(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  return [...new Uint8Array(signature)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async (request: Request) => {
  // Only the scheduler drains the queue. Unauthenticated, the anon key could
  // drive continuous delivery — a POST-flood aimed at the endpoints on file.
  const refused = refuseUnlessCron(request);
  if (refused) return refused;

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  );

  const { data: due, error } = await admin
    .from('webhook_deliveries')
    .select('id, event, payload, attempts, webhook_endpoints (url, secret, active)')
    .is('delivered_at', null)
    .lte('next_attempt_at', new Date().toISOString())
    .lt('attempts', MAX_ATTEMPTS)
    .order('next_attempt_at')
    .limit(BATCH);

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }

  let delivered = 0;
  let failed = 0;

  for (const row of due ?? []) {
    const endpoint = Array.isArray(row.webhook_endpoints)
      ? row.webhook_endpoints[0]
      : row.webhook_endpoints;
    const attempts = row.attempts + 1;
    const now = new Date();

    // Switched off since this was queued. Not a failure and not worth
    // retrying — record it and move on.
    if (!endpoint?.active) {
      await admin
        .from('webhook_deliveries')
        .update({ attempts, last_error: 'endpoint is no longer active', next_attempt_at: null })
        .eq('id', row.id);
      continue;
    }

    const body = JSON.stringify(row.payload);
    let status = 0;
    let message: string | null = null;

    // Refuse a destination that points inside the network before opening a
    // connection to it. A blocked endpoint is a permanent misconfiguration, not
    // a blip — retrying it would just probe the same internal target on a
    // schedule — so it is failed outright below via isWorthRetrying(0).
    const blocked = blockedReason(endpoint.url);
    if (blocked) {
      message = `refused to deliver: ${blocked}`;
    } else {
      try {
        const response = await fetch(endpoint.url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-QC2GO-Event': row.event,
            'X-QC2GO-Signature': `sha256=${await sign(endpoint.secret, body)}`,
            'X-QC2GO-Delivery': String(row.id),
          },
          body,
          // A 3xx is not followed. Following it would let a public URL that
          // passed the check above redirect the request onto an internal host,
          // which is the whole SSRF back door reopened. A receiver that wants a
          // different URL can say so; we do not chase it.
          redirect: 'manual',
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        status = response.status;
        // An opaqueredirect (or any 3xx) is treated as a failed delivery, not a
        // success — the body never reached a verified endpoint.
        if (response.type === 'opaqueredirect' || (status >= 300 && status < 400)) {
          status = 0;
          message = 'the destination redirected; redirects are not followed';
        } else if (!isDelivered(status)) {
          // The first part of the body, for somebody diagnosing this in Settings.
          // Whole error pages are not worth storing per delivery.
          message = (await response.text().catch(() => '')).slice(0, 500) || `HTTP ${status}`;
        }
      } catch (problem) {
        message = problem instanceof Error ? problem.message : String(problem);
      }
    }

    if (isDelivered(status)) {
      delivered += 1;
      await admin
        .from('webhook_deliveries')
        .update({ attempts, delivered_at: now.toISOString(), last_status: status, last_error: null })
        .eq('id', row.id);
      continue;
    }

    failed += 1;
    // A blocked destination never becomes deliverable by waiting, and retrying
    // it is exactly the repeated internal probe the block exists to stop.
    const retryAt =
      !blocked && isWorthRetrying(status) ? nextAttemptAfter(attempts, now) : null;
    await admin
      .from('webhook_deliveries')
      .update({
        attempts: retryAt ? attempts : MAX_ATTEMPTS,
        last_status: status || null,
        last_error: message,
        next_attempt_at: (retryAt ?? now).toISOString(),
      })
      .eq('id', row.id);
  }

  return new Response(JSON.stringify({ considered: due?.length ?? 0, delivered, failed }), {
    headers: { 'Content-Type': 'application/json' },
  });
});
