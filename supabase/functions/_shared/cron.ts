/**
 * The gate for a function only the scheduler should call.
 *
 * `deliver-webhooks` and `sweep-photos` take no human caller. They are invoked
 * by `pg_cron`, which already sends `Authorization: Bearer <service-role-key>`
 * (see supabase/README.md). What was missing is anyone *checking* that.
 *
 * Left unchecked, "authenticated" is not much of a bar: Supabase verifies the
 * JWT by default, and the project's own **anon key is a valid JWT** — a value
 * shipped in every copy of the web client and therefore public. So without this,
 * a stranger with the anon key can drive `sweep-photos`, whose whole job is to
 * permanently delete evidence, as fast as they like.
 *
 * The bearer is compared to the service-role key the function already holds in
 * its environment. Nothing new to configure, and the existing cron schedule
 * keeps working unchanged, because it was already sending exactly this.
 */

/** Constant-time compare, so a wrong token leaks nothing through timing. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i += 1) {
    difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return difference === 0;
}

/**
 * Returns a 401 Response when the caller is not the scheduler, or null when the
 * request may proceed. Fails closed: if the function has no service-role key in
 * its environment it can authorise nobody, which is the safe direction for a
 * job that deletes.
 */
export function refuseUnlessCron(request: Request): Response | null {
  const expected = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const header = request.headers.get('Authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';

  if (expected.length === 0 || token.length === 0 || !timingSafeEqual(token, expected)) {
    return new Response(JSON.stringify({ error: 'Not authorized.' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  return null;
}
