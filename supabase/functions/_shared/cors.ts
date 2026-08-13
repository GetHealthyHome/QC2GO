/**
 * The CORS reply every browser-facing function gives, in one place.
 *
 * This is here because getting it wrong fails in a way that looks like
 * something else entirely. A preflight that answers 200 but does not name a
 * header the client is about to send is not an error the browser reports as
 * CORS — it simply never sends the real request, and `supabase-js` surfaces
 * that as **"Failed to send a request to the Edge Function"**. The function
 * logs show `OPTIONS 200` and no POST at all, which reads like a network
 * problem, a bad deploy, or a missing function. It is none of those.
 *
 * ## What the client actually sends
 *
 * `supabase.functions.invoke()` sends three headers of its own:
 *
 * - `Authorization` — the signed-in user's JWT.
 * - `Content-Type` — `application/json` for an object body.
 * - `X-Client-Info` — the library's own version string. Set unconditionally
 *   from `DEFAULT_HEADERS` in supabase-js, on every call, and easy to forget
 *   precisely because no application code ever mentions it.
 *
 * `apikey` is listed too. The client does not send it today, but it is the
 * conventional Supabase allow-list entry, several of their own examples set it
 * explicitly, and naming a header nobody sends costs nothing.
 *
 * `scripts/check-cors.mjs` asserts this list against what supabase-js is
 * actually compiled to send, so a library upgrade that adds a header fails a
 * test rather than one feature in production.
 *
 * Not used by `shared-report`, which is reached by a plain `fetch` with no
 * Authorization and no client-info, and whose narrower list is correct for it.
 */
export const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

/** A JSON reply carrying the CORS headers, which every reply has to. */
export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

/** The preflight reply. Every browser-facing function answers OPTIONS. */
export function preflight(): Response {
  return new Response('ok', { headers: CORS });
}
