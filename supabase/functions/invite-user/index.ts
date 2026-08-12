/**
 * invite-user — the only way somebody joins a company.
 *
 * Runs as a Supabase Edge Function because it needs the `service_role` key to
 * call the admin API that sends the invitation email, and that key bypasses
 * row-level security entirely. It must never reach a browser, so this is the
 * first piece of QC2GO that runs on a server rather than on a phone.
 *
 * Because the key bypasses RLS, nothing underneath this function will catch a
 * mistake in it. Two habits guard against that:
 *
 *   1. The caller is read back from the database with their *own* token, not the
 *      service key — so who they are and what company they are in is answered by
 *      the same policies that answer it everywhere else.
 *   2. The decision itself lives in `authorize.ts` as a pure function, tested
 *      directly by `npm run check:invite-authorization`.
 *
 * Deploy:  supabase functions deploy invite-user
 */
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { authorizeInvite, type CallerProfile } from './authorize.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (request.method !== 'POST') return json({ error: 'Use POST.' }, 405);

  const url = Deno.env.get('SUPABASE_URL')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  // Where the invitation link lands. Set this per deployment; without it the
  // link would point at Supabase's own default and the person would never
  // reach the app.
  const siteUrl = Deno.env.get('QC2GO_SITE_URL') ?? '';

  const authorization = request.headers.get('Authorization') ?? '';

  // Read the caller through their own token, so their company and role come
  // back filtered by the same policies as everywhere else in the app.
  const asCaller = createClient(url, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false },
  });

  const { data: auth } = await asCaller.auth.getUser();
  let caller: CallerProfile | null = null;
  if (auth?.user) {
    const { data } = await asCaller
      .from('profiles')
      .select('id, role, org_id')
      .eq('id', auth.user.id)
      .maybeSingle();
    if (data) caller = data as CallerProfile;
  }

  let body: Record<string, unknown> = {};
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Send a JSON body.' }, 400);
  }

  const decision = authorizeInvite(caller, body);
  if (!decision.ok) return json({ error: decision.message }, decision.status);

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

  // An expired invitation still occupies the one-live-invitation-per-address
  // slot, and nobody can act on it any more. Clear it out rather than reporting
  // a conflict the owner has no way to resolve.
  await admin
    .from('invites')
    .delete()
    .is('accepted_at', null)
    .lt('expires_at', new Date().toISOString())
    .ilike('email', decision.email);

  const { data: invite, error: inviteError } = await admin
    .from('invites')
    .insert({
      org_id: decision.orgId,
      email: decision.email,
      role: decision.role,
      invited_by: decision.invitedBy,
    })
    .select('id, email, role, expires_at')
    .single();

  if (inviteError) {
    // 23505 is the one-live-invitation-per-address index. That is a real answer
    // rather than a failure — somebody is already waiting on an invitation to
    // this address, possibly at another company.
    if (inviteError.code === '23505') {
      return json(
        { error: 'There is already an invitation waiting for that address.' },
        409,
      );
    }
    return json({ error: inviteError.message }, 400);
  }

  const { error: emailError } = await admin.auth.admin.inviteUserByEmail(decision.email, {
    redirectTo: siteUrl || undefined,
    // Read on first sign-in to decide whether to ask for a password. Without it
    // the app cannot tell an invited account from an established one, and would
    // either nag everybody or nobody.
    data: { needs_password: true },
  });

  if (emailError) {
    // The row without the email is worse than neither: the address is now
    // blocked by the unique index and nobody has been told anything.
    await admin.from('invites').delete().eq('id', invite.id);

    const already = emailError.message.toLowerCase().includes('already been registered');
    return json(
      {
        error: already
          ? 'That address already has an account. It belongs to whichever company it joined first.'
          : emailError.message,
      },
      already ? 409 : 400,
    );
  }

  return json({ invite });
});
