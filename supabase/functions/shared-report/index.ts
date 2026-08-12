/**
 * shared-report — serves one finished report to somebody with a link.
 *
 * The only function here that an anonymous caller reaches. It runs with the
 * service key because the caller has no company to be scoped to, which means
 * the usual safety net is absent and everything it will not disclose has to be
 * decided explicitly: `access.ts` holds both the reasons to refuse and the
 * allow-list of what a reader may see.
 *
 * Deploy:  supabase functions deploy shared-report --no-verify-jwt
 *
 * `--no-verify-jwt` is the point — the recipient is not signed in.
 */
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { decideAccess, decideRecord, publicReport } from './access.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Photos stay in a private bucket; a reader gets a short-lived URL, not a key. */
const PHOTO_URL_TTL_SECONDS = 60 * 60;

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (request.method !== 'POST') return json({ error: 'Use POST.' }, 405);

  let body: { token?: unknown; passcode?: unknown } = {};
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Send a JSON body.' }, 400);
  }
  if (typeof body.token !== 'string' || body.token.length < 20) {
    return json({ error: 'This link is not valid any more. Ask for a new one.' }, 404);
  }

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  );

  const { data: share } = await admin
    .from('report_shares')
    .select('id, inspection_id, org_id, expires_at, revoked_at, passcode_hash, view_count')
    .eq('token_hash', await sha256(body.token))
    .maybeSingle();

  const passcodeHash =
    typeof body.passcode === 'string' && body.passcode.length > 0
      ? await sha256(body.passcode)
      : null;

  const decision = decideAccess(share ?? null, passcodeHash, new Date());
  if (!decision.ok) {
    return json(
      { error: decision.message, needsPasscode: decision.status === 401 },
      decision.status,
    );
  }

  const [{ data: inspection }, { data: photos }] = await Promise.all([
    admin.from('inspections').select('*').eq('id', share!.inspection_id).maybeSingle(),
    admin
      .from('photos')
      .select('id, question_id, storage_path, annotations')
      .eq('inspection_id', share!.inspection_id),
  ]);

  const record = decideRecord(inspection ?? null, share!.org_id);
  if (!record.ok) return json({ error: record.message }, record.status);

  const [{ data: customer }, { data: organization }] = await Promise.all([
    admin
      .from('customers')
      .select('customer_name, address')
      .eq('id', inspection.customer_id)
      .maybeSingle(),
    admin.from('organizations').select('name, logo').eq('id', share!.org_id).maybeSingle(),
  ]);

  // Signed URLs rather than bucket keys: the bucket is private, and a key would
  // be useless to the reader and a hint to anybody else.
  const withUrls = await Promise.all(
    (photos ?? []).map(async (photo) => {
      const { data } = await admin.storage
        .from('inspection-photos')
        .createSignedUrl(photo.storage_path, PHOTO_URL_TTL_SECONDS);
      return { ...photo, url: data?.signedUrl ?? null };
    }),
  );

  // Counted after the decision, so a refused attempt does not register as a
  // view. Not awaited — a reader should never wait on bookkeeping.
  void admin
    .from('report_shares')
    .update({ view_count: (share!.view_count ?? 0) + 1, last_viewed_at: new Date().toISOString() })
    .eq('id', share!.id);

  return json(
    publicReport({
      inspection,
      customer: customer ?? null,
      organization: organization ?? null,
      photos: withUrls.filter((photo) => photo.url),
    }),
  );
});
