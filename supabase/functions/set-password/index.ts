/**
 * set-password — an owner or admin gives somebody a password directly.
 *
 * The invitation flow assumes an email address somebody can actually reach.
 * A lot of crew members do not have a work email, read it, or have it set up on
 * the phone they are standing there holding, and "check your inbox for a link"
 * is not an answer when the job starts in ten minutes. This is the other way in:
 * the person managing the company types a password and says it out loud.
 *
 * Two things make that safe rather than merely convenient:
 *
 *   1. **The password is temporary by construction.** `needs_password` is set
 *      on the account, which is the same flag an invitation sets, so the app
 *      puts them on "Choose a password" before anything else at next sign-in.
 *      Whatever the admin typed stops working the moment the person picks their
 *      own, so a password spoken aloud on a driveway has a life measured in
 *      minutes and the admin does not keep knowing it.
 *   2. **An admin may only reset an inspector**, so this cannot be used to
 *      climb. See `authorize.ts` — that decision is pure and tested.
 *
 * Runs with the `service_role` key because the admin API is the only thing that
 * can set a password on another account. That key bypasses row-level security
 * entirely and must never reach a browser, which is why this is on a server.
 *
 * What this is *not* is a way to lock somebody out. It changes what is needed to
 * sign in next time; it does not reliably end a session already signed in, and
 * this app deliberately keeps people signed in for months. For somebody who has
 * left, or a handset that has gone missing, `profiles.active` is the control
 * meant for that.
 *
 * Deploy:  supabase functions deploy set-password
 */
import { createClient } from 'jsr:@supabase/supabase-js@2';
import {
  authorizeCreateMember,
  authorizeSetPassword,
  type CallerProfile,
  type TargetProfile,
} from './authorize.ts';
import { json, preflight } from '../_shared/cors.ts';

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return preflight();
  if (request.method !== 'POST') return json({ error: 'Use POST.' }, 405);

  const url = Deno.env.get('SUPABASE_URL')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  const authorization = request.headers.get('Authorization') ?? '';

  // Read the caller through their own token, so their company and role are
  // answered by the same policies that answer them everywhere else.
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

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

  // -------------------------------------------------------------------------
  // Adding somebody who has no account yet
  // -------------------------------------------------------------------------
  if (body.action === 'create') {
    const decision = authorizeCreateMember(caller, body);
    if (!decision.ok) return json({ error: decision.message }, decision.status);
    if (decision.action !== 'create') return json({ error: 'Unreachable.' }, 500);

    // The invitation row goes first, and it is not a formality: `handle_new_user`
    // reads it to decide which company the new profile belongs to and with what
    // role. Creating the account without it would land a profile with no company
    // — an account that signs in and sees nothing.
    const { data: invite, error: inviteError } = await admin
      .from('invites')
      .insert({
        org_id: decision.orgId,
        email: decision.email,
        role: decision.role,
        invited_by: decision.invitedBy,
      })
      .select('id')
      .single();

    if (inviteError) {
      if (inviteError.code === '23505') {
        return json(
          { error: 'There is already an invitation waiting for that address.' },
          409,
        );
      }
      return json({ error: inviteError.message }, 400);
    }

    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email: decision.email,
      password: decision.password,
      // No inbox round trip — that is the entire point of this path.
      email_confirm: true,
      user_metadata: {
        full_name: decision.fullName,
        // Same flag an invitation sets: the app asks them to choose their own
        // password before it shows them anything.
        needs_password: true,
      },
    });

    if (createError) {
      // A stranded invite row would hold the one-live-invitation-per-address
      // slot with nobody able to act on it.
      await admin.from('invites').delete().eq('id', invite.id);
      const already = createError.message.toLowerCase().includes('already been registered');
      return json(
        {
          error: already
            ? 'That address already has an account. Reset its password instead of adding it again.'
            : createError.message,
        },
        already ? 409 : 400,
      );
    }

    await admin.from('audit_log').insert({
      org_id: decision.orgId,
      actor: caller!.id,
      actor_email: auth?.user?.email ?? null,
      entity: 'profile',
      entity_id: created.user.id,
      action: 'member_created_with_password',
      details: { email: decision.email, role: decision.role },
    });

    return json({
      member: { id: created.user.id, email: decision.email, role: decision.role },
    });
  }

  // -------------------------------------------------------------------------
  // Resetting somebody who already has one
  // -------------------------------------------------------------------------

  // Read the target through the caller's token as well. Somebody in another
  // company comes back empty here, so the policies decide visibility before the
  // pure function is asked anything — and the function refuses a null target.
  let target: TargetProfile | null = null;
  if (typeof body.userId === 'string' && body.userId.length > 0) {
    const { data } = await asCaller
      .from('profiles')
      .select('id, email, role, org_id')
      .eq('id', body.userId)
      .maybeSingle();
    if (data) target = data as TargetProfile;
  }

  const decision = authorizeSetPassword(caller, target, body);
  if (!decision.ok) return json({ error: decision.message }, decision.status);
  if (decision.action !== 'set') return json({ error: 'Unreachable.' }, 500);

  const isSelf = decision.targetId === caller!.id;

  const { error: updateError } = await admin.auth.admin.updateUserById(decision.targetId, {
    password: decision.password,
    // For somebody else, the new password is a one-time key rather than their
    // password: they choose their own at next sign-in, and whoever typed this
    // one stops knowing what it is.
    //
    // Not for yourself. You just chose this password deliberately — being made
    // to choose it again at the next sign-in would be the app not believing
    // you, and this is also the only way to change your own password from
    // inside the app.
    ...(isSelf ? {} : { user_metadata: { needs_password: true } }),
  });

  if (updateError) return json({ error: updateError.message }, 400);

  // Never the password, and never a hint about it. What matters afterwards is
  // that somebody could have signed in as this person from this moment, and who
  // that somebody was.
  await admin.from('audit_log').insert({
    org_id: caller!.org_id,
    actor: caller!.id,
    actor_email: auth?.user?.email ?? null,
    entity: 'profile',
    entity_id: decision.targetId,
    action: isSelf ? 'password_changed' : 'password_set_by_admin',
    details: { email: decision.targetEmail, self: isSelf },
  });

  return json({ ok: true });
});
