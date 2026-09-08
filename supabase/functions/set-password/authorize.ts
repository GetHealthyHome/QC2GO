/**
 * Who may set whose password, decided as a pure function.
 *
 * Setting somebody's password is handing over their account. There is no
 * "partly" about it: whoever knows the password is that person as far as the
 * system is concerned, including for anything already signed in their name. So
 * this is the second piece of QC2GO that runs with the `service_role` key, and
 * like `invite-user` it has no row-level security underneath it to catch a
 * mistake. The decision therefore lives here, in isolation, where every case it
 * has to refuse is asserted directly by
 * `scripts/check-set-password-authorization.mjs`.
 *
 * Two rules carry the weight:
 *
 * **The company comes from the caller, never from the request.** Same as
 * invitations. A request naming an organization is a claim with nothing behind
 * it. The target is additionally read back through the caller's own token, so
 * somebody in another company simply does not exist as far as this is concerned.
 *
 * **An admin may only reset an inspector.** This is the rule that stops the
 * feature from being a way to take over the company. If an admin could set an
 * owner's password, then admin and owner would be the same rank in practice —
 * the admin would just take the owner's account and use it. The same argument
 * applies to another admin, so that is refused too. What is left is exactly the
 * everyday case this exists for: a crew member who has forgotten their password
 * and is standing in front of you.
 */

export type Role = 'owner' | 'admin' | 'inspector';

export interface CallerProfile {
  id: string;
  role: string;
  org_id: string | null;
}

export interface TargetProfile {
  id: string;
  email: string;
  role: string;
  org_id: string | null;
}

export type Decision =
  | { ok: true; action: 'set'; targetId: string; targetEmail: string; password: string }
  | {
      ok: true;
      action: 'create';
      email: string;
      password: string;
      role: Role;
      orgId: string;
      invitedBy: string;
      fullName: string;
    }
  | { ok: false; status: number; message: string };

const ROLES: Role[] = ['owner', 'admin', 'inspector'];

export const MIN_PASSWORD = 10;

/**
 * bcrypt — which is what Supabase hashes with — ignores everything past 72
 * bytes. A longer password is not stronger, it is silently truncated, and the
 * person typing it believes something about their account that is not true.
 * Refusing is honest; accepting quietly is not.
 */
export const MAX_PASSWORD_BYTES = 72;

/**
 * Passwords long enough to pass the length rule but still the first thing
 * anybody would try. This is not a serious denylist and is not meant to be —
 * it exists because a password set *for* somebody else, by an admin in a hurry,
 * is exactly where these turn up.
 */
const OBVIOUS = new Set([
  'password12',
  'password123',
  'password1234',
  '1234567890',
  '12345678901',
  '123456789012',
  'qwertyuiop',
  'qwerty12345',
  'letmein123',
  'welcome123',
  'iloveyou12',
  'admin12345',
  'changeme12',
  'passw0rd12',
]);

function byteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

/** Returns a message explaining the refusal, or null when the password is fine. */
export function validatePassword(value: unknown, email?: string): string | null {
  if (typeof value !== 'string' || value.length === 0) {
    return 'Choose a password.';
  }
  if (value.length < MIN_PASSWORD) {
    return `Use at least ${MIN_PASSWORD} characters.`;
  }
  if (byteLength(value) > MAX_PASSWORD_BYTES) {
    return `That is too long — ${MAX_PASSWORD_BYTES} bytes is the most that counts, and anything past it would be ignored rather than stored.`;
  }
  // Leading and trailing spaces survive into the stored password and then get
  // eaten by autofill, phone keyboards and copy-paste. The person is then
  // locked out by a character they cannot see.
  if (value !== value.trim()) {
    return 'Remove the spaces at the start or end — they are too easy to lose when it is typed back in.';
  }
  if (value.trim().length === 0) {
    return 'Choose a password.';
  }
  if (OBVIOUS.has(value.toLowerCase())) {
    return 'That is one of the first passwords anybody would try. Choose another.';
  }
  if (email && value.toLowerCase() === email.toLowerCase()) {
    return 'The password cannot be the email address.';
  }
  // The local part on its own is the same mistake wearing a hat.
  const local = email?.split('@')[0]?.toLowerCase();
  if (local && local.length >= MIN_PASSWORD && value.toLowerCase() === local) {
    return 'The password cannot be the email address.';
  }
  return null;
}

/**
 * Deliberately strict rather than clever — the same check invitations use. An
 * address that does not survive this is one nobody could ever sign in with.
 */
function normalizeEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  if (email.length === 0 || email.length > 254) return null;
  if (!/^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(email)) return null;
  return email;
}

/** Resetting the password of somebody who already has an account. */
export function authorizeSetPassword(
  caller: CallerProfile | null,
  target: TargetProfile | null,
  body: { password?: unknown },
): Decision {
  if (!caller) {
    return { ok: false, status: 401, message: 'Sign in first.' };
  }
  if (!caller.org_id) {
    return {
      ok: false,
      status: 403,
      message: 'This account is not part of a company.',
    };
  }
  if (caller.role !== 'owner' && caller.role !== 'admin') {
    return {
      ok: false,
      status: 403,
      message: 'Only an owner or an admin can set somebody else’s password.',
    };
  }

  // Null because the lookup ran with the caller's own token: somebody in
  // another company is not "forbidden", they are not visible at all, and saying
  // so would confirm the account exists.
  if (!target) {
    return { ok: false, status: 404, message: 'No such person in this company.' };
  }
  if (target.org_id !== caller.org_id) {
    return { ok: false, status: 404, message: 'No such person in this company.' };
  }

  // Your own account is always yours to change; no rank is being crossed.
  const isSelf = target.id === caller.id;

  if (!isSelf && caller.role === 'admin' && target.role !== 'inspector') {
    return {
      ok: false,
      status: 403,
      message:
        'An admin can only reset an inspector’s password. Ask an owner to reset this one.',
    };
  }

  const problem = validatePassword(body.password, target.email);
  if (problem) return { ok: false, status: 400, message: problem };

  return {
    ok: true,
    action: 'set',
    targetId: target.id,
    targetEmail: target.email,
    password: body.password as string,
  };
}

/**
 * Creating an account with a password already on it — onboarding somebody with
 * no work email to receive an invitation at.
 *
 * Owner-only, because this is adding a person to the company, and that has been
 * an owner's decision since invitations existed. An admin resetting a password
 * is helping somebody already on the roster; this is changing who is on it.
 */
export function authorizeCreateMember(
  caller: CallerProfile | null,
  body: { email?: unknown; password?: unknown; role?: unknown; fullName?: unknown },
): Decision {
  if (!caller) {
    return { ok: false, status: 401, message: 'Sign in first.' };
  }
  if (!caller.org_id) {
    return {
      ok: false,
      status: 403,
      message: 'This account is not part of a company, so it cannot add anyone.',
    };
  }
  if (caller.role !== 'owner') {
    return {
      ok: false,
      status: 403,
      message: 'Only an owner can add somebody to the company.',
    };
  }

  const email = normalizeEmail(body.email);
  if (!email) {
    return { ok: false, status: 400, message: 'That does not look like an email address.' };
  }

  const role = body.role ?? 'inspector';
  if (typeof role !== 'string' || !ROLES.includes(role as Role)) {
    return { ok: false, status: 400, message: `Role must be one of ${ROLES.join(', ')}.` };
  }

  const problem = validatePassword(body.password, email);
  if (problem) return { ok: false, status: 400, message: problem };

  const fullName = typeof body.fullName === 'string' ? body.fullName.trim().slice(0, 120) : '';

  return {
    ok: true,
    action: 'create',
    email,
    password: body.password as string,
    role: role as Role,
    // From the caller's own profile row, exactly as invitations do it.
    orgId: caller.org_id,
    invitedBy: caller.id,
    fullName,
  };
}
