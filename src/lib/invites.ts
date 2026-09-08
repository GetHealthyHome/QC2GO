import { supabase } from './supabase';
import type { Role } from './types';

export interface Invite {
  id: string;
  email: string;
  role: Role;
  createdAt: string;
  expiresAt: string;
  acceptedAt?: string;
}

export interface Member {
  id: string;
  email: string;
  fullName: string;
  role: Role;
  active: boolean;
}

function rowToInvite(row: Record<string, unknown>): Invite {
  return {
    id: String(row.id),
    email: String(row.email),
    role: row.role as Role,
    createdAt: String(row.created_at),
    expiresAt: String(row.expires_at),
    acceptedAt: row.accepted_at ? String(row.accepted_at) : undefined,
  };
}

/** The company roster. Row-level security scopes it — there is no org filter here. */
export async function listMembers(): Promise<Member[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('profiles')
    .select('id, email, full_name, role, active')
    .order('role')
    .order('email');
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({
    id: String(row.id),
    email: String(row.email),
    fullName: String(row.full_name ?? ''),
    role: row.role as Role,
    active: row.active !== false,
  }));
}

/** Invitations nobody has accepted yet. */
export async function listPendingInvites(): Promise<Invite[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('invites')
    .select('id, email, role, created_at, expires_at, accepted_at')
    .is('accepted_at', null)
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map(rowToInvite);
}

/**
 * Sending the invitation needs the admin API, which needs the `service_role`
 * key — so it happens in an Edge Function rather than here. This only asks.
 *
 * Note what is *not* sent: the company. The function reads that from the
 * caller's own profile, because a company named in a request body is a claim
 * with nothing behind it.
 */
export async function inviteMember(email: string, role: Role): Promise<{ error?: string }> {
  if (!supabase) return { error: 'Invitations need a backend. This deployment has none.' };
  return callFunction('invite-user', { email, role }, 'The invitation could not be sent.');
}

/**
 * Call an Edge Function and surface the reason it refused.
 *
 * Worth having in one place: the functions answer a refusal with a readable
 * message and a status, but `supabase-js` reports only that something failed
 * and hides the body on the error's `context`. Without digging it out, "an
 * admin can only reset an inspector's password" reaches the screen as "Edge
 * Function returned a non-2xx status code".
 */
async function callFunction(
  name: string,
  body: Record<string, unknown>,
  fallback: string,
): Promise<{ error?: string }> {
  const { data, error } = await supabase!.functions.invoke(name, { body });

  if (error) {
    const context = (error as { context?: Response }).context;
    if (context && typeof context.json === 'function') {
      try {
        const parsed = await context.json();
        if (parsed?.error) return { error: String(parsed.error) };
      } catch {
        // Fall through to the generic message below.
      }
    }
    return { error: error.message || fallback };
  }

  if (data?.error) return { error: String(data.error) };
  return {};
}

/**
 * Give somebody a password directly, without an email round trip.
 *
 * Needs the admin API and therefore the `service_role` key, so it happens in an
 * Edge Function; this only asks. The account is flagged `needs_password`, so
 * whatever is set here is a one-time key — the person chooses their own before
 * the app shows them anything.
 *
 * Who may do this to whom is decided on the server: an owner can reset anyone
 * in the company, an admin only an inspector. An admin resetting an owner would
 * be an admin taking the company.
 */
export async function setMemberPassword(
  userId: string,
  password: string,
): Promise<{ error?: string }> {
  if (!supabase) return { error: 'Passwords need a backend. This deployment has none.' };
  return callFunction(
    'set-password',
    { action: 'set', userId, password },
    'The password could not be set.',
  );
}

/**
 * Add somebody who has no account at all and give them a password on the spot —
 * for a crew member with no work email to receive an invitation at.
 *
 * Owner-only: this changes who is on the roster, which has been an owner's
 * decision since invitations existed.
 */
export async function addMemberWithPassword(input: {
  email: string;
  password: string;
  role: Role;
  fullName?: string;
}): Promise<{ error?: string }> {
  if (!supabase) return { error: 'Accounts need a backend. This deployment has none.' };
  return callFunction(
    'set-password',
    { action: 'create', ...input },
    'The account could not be created.',
  );
}

/** Withdraw an invitation nobody has accepted. Owner-only, enforced by policy. */
export async function revokeInvite(id: string): Promise<{ error?: string }> {
  if (!supabase) return { error: 'Invitations need a backend. This deployment has none.' };
  const { error } = await supabase.from('invites').delete().eq('id', id);
  return error ? { error: error.message } : {};
}

/** Change somebody's role. Admins and owners only, enforced by policy. */
export async function setMemberRole(id: string, role: Role): Promise<{ error?: string }> {
  if (!supabase) return { error: 'Roles need a backend. This deployment has none.' };
  const { error } = await supabase.from('profiles').update({ role }).eq('id', id);
  return error ? { error: error.message } : {};
}
