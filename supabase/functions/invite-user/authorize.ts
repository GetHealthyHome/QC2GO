/**
 * Who may invite whom, decided as a pure function.
 *
 * This is the one piece of QC2GO that runs with the `service_role` key, which
 * bypasses row-level security entirely. Every other write in the system is
 * checked by a policy; here there is no policy underneath to catch a mistake.
 * So the decision is made here, in isolation, where it can be tested directly —
 * `scripts/check-invite-authorization.mjs` runs every case below, including the
 * ones that must be refused.
 *
 * The rule that matters most: **the organization comes from the caller, never
 * from the request.** A body that names an org is not asking a question, it is
 * making a claim, and there is nothing behind it to verify the claim against.
 */

export type Role = 'owner' | 'admin' | 'inspector';

export interface CallerProfile {
  id: string;
  role: string;
  org_id: string | null;
}

export interface InviteRequest {
  email?: unknown;
  role?: unknown;
}

export type Decision =
  | { ok: true; email: string; role: Role; orgId: string; invitedBy: string }
  | { ok: false; status: number; message: string };

const ROLES: Role[] = ['owner', 'admin', 'inspector'];

/**
 * Deliberately strict rather than clever. An address that does not survive this
 * is one the invitation would be sent into a void for, and the person waiting
 * for it would have no way of finding that out.
 */
function normalizeEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  if (email.length === 0 || email.length > 254) return null;
  if (!/^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(email)) return null;
  return email;
}

export function authorizeInvite(caller: CallerProfile | null, body: InviteRequest): Decision {
  if (!caller) {
    return { ok: false, status: 401, message: 'Sign in to invite somebody.' };
  }

  // An account with no company has nobody to invite into. This is the same
  // state the app shows as "not part of a company yet".
  if (!caller.org_id) {
    return {
      ok: false,
      status: 403,
      message: 'This account is not part of a company, so it cannot invite anyone.',
    };
  }

  if (caller.role !== 'owner') {
    return {
      ok: false,
      status: 403,
      message: 'Only an owner can invite people into the company.',
    };
  }

  const email = normalizeEmail(body.email);
  if (!email) {
    return { ok: false, status: 400, message: 'That does not look like an email address.' };
  }

  const role = body.role ?? 'inspector';
  if (typeof role !== 'string' || !ROLES.includes(role as Role)) {
    return {
      ok: false,
      status: 400,
      message: `Role must be one of ${ROLES.join(', ')}.`,
    };
  }

  return {
    ok: true,
    email,
    role: role as Role,
    // From the caller's own profile row. Whatever the request said about a
    // company is discarded here and never read again.
    orgId: caller.org_id,
    invitedBy: caller.id,
  };
}
