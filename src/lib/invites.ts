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

  const { data, error } = await supabase.functions.invoke('invite-user', {
    body: { email, role },
  });

  if (error) {
    // The function answers refusals with a readable message and a status; the
    // client library reports only that something failed, so dig the message out.
    const context = (error as { context?: Response }).context;
    if (context && typeof context.json === 'function') {
      try {
        const body = await context.json();
        if (body?.error) return { error: String(body.error) };
      } catch {
        // Fall through to the generic message below.
      }
    }
    return { error: error.message || 'The invitation could not be sent.' };
  }

  if (data?.error) return { error: String(data.error) };
  return {};
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
