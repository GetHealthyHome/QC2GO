import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../lib/auth';
import {
  addMemberWithPassword,
  inviteMember,
  listMembers,
  listPendingInvites,
  revokeInvite,
  setMemberPassword,
  setMemberRole,
  type Invite,
  type Member,
} from '../lib/invites';
import { MIN_PASSWORD, generatePassword, passwordProblem } from '../lib/password';
import { formatDate, relativeTime } from '../lib/inspection';
import type { Role } from '../lib/types';
import { Badge, Button, Card, Field, Screen, TextInput, TopBar, cx } from '../components/ui';
import { AlertIcon, TrashIcon, UserIcon } from '../components/Icons';

const ROLE_LABELS: Record<Role, string> = {
  owner: 'Owner',
  admin: 'Admin',
  inspector: 'Inspector',
};

const ROLE_HELP: Record<Role, string> = {
  owner: 'Everything an admin can do, plus managing who is in the company.',
  admin: 'Runs inspections, and builds and edits checklists.',
  inspector: 'Runs inspections and reads every report in the company.',
};

const INVITABLE: Role[] = ['inspector', 'admin', 'owner'];

/**
 * Whether the signed-in person may set this member's password.
 *
 * Mirrors `supabase/functions/set-password/authorize.ts`, which is what actually
 * refuses. This is here so the button is absent rather than present-and-failing:
 * an admin should not be offered a "Reset password" on the owner at all.
 */
function canResetPassword(caller: Member | undefined, target: Member): boolean {
  if (!caller) return false;
  if (caller.role !== 'owner' && caller.role !== 'admin') return false;
  // Your own account is always yours to change.
  if (caller.id === target.id) return true;
  if (caller.role === 'owner') return true;
  // An admin resetting an owner or another admin would be an admin taking a
  // rank they were not given.
  return target.role === 'inspector';
}

/**
 * The company roster, and the invitations that have not been taken up yet.
 *
 * Everything here is scoped by row-level security rather than by a filter in
 * the query — `listMembers` asks for every profile it is allowed to see, and
 * the server answers with the caller's own company.
 */
export function PeopleScreen() {
  const auth = useAuth();
  const isOwner = auth.profile?.role === 'owner';

  const [members, setMembers] = useState<Member[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('inspector');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<string | null>(null);

  // Adding somebody by email, or handing them a password on the spot. Same
  // decision — who is on the roster — reached two ways, so one form with a
  // mode rather than two forms competing for the same space.
  const [mode, setMode] = useState<'invite' | 'direct'>('invite');
  const [fullName, setFullName] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [added, setAdded] = useState<{ email: string; password: string } | null>(null);

  const me = members.find((member) => member.id === auth.profile?.id);

  const refresh = useCallback(async () => {
    try {
      const [roster, pending] = await Promise.all([listMembers(), listPendingInvites()]);
      setMembers(roster);
      setInvites(pending);
      setError(null);
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'Could not read the roster.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function invite(event: React.FormEvent) {
    event.preventDefault();
    if (sending || !email.trim()) return;

    const address = email.trim();
    const problem = mode === 'direct' ? passwordProblem(newPassword, address) : null;
    if (problem) {
      setError(problem);
      return;
    }

    setSending(true);
    setError(null);
    setSent(null);
    setAdded(null);

    const result =
      mode === 'invite'
        ? await inviteMember(address, role)
        : await addMemberWithPassword({
            email: address,
            password: newPassword,
            role,
            fullName: fullName.trim(),
          });

    if (result.error) {
      setError(result.error);
    } else {
      if (mode === 'invite') {
        setSent(address);
      } else {
        // Held on screen deliberately: this is the only moment anybody can read
        // it out, and it is not recoverable afterwards.
        setAdded({ email: address, password: newPassword });
        setNewPassword('');
        setFullName('');
      }
      setEmail('');
      await refresh();
    }
    setSending(false);
  }

  async function withdraw(invitation: Invite) {
    if (!window.confirm(`Withdraw the invitation to ${invitation.email}?`)) return;
    const result = await revokeInvite(invitation.id);
    if (result.error) setError(result.error);
    await refresh();
  }

  async function changeRole(member: Member, next: Role) {
    const result = await setMemberRole(member.id, next);
    if (result.error) setError(result.error);
    await refresh();
  }

  return (
    <>
      <TopBar title="People" subtitle={auth.profile?.organization?.name} back="/settings" />
      <Screen className="pb-10">
        {error ? (
          <p className="mb-3 flex items-start gap-1.5 rounded-xl bg-fail-50 px-3 py-2.5 text-[13px] font-medium text-fail-700">
            <AlertIcon className="mt-0.5 size-4 shrink-0" />
            <span>{error}</span>
          </p>
        ) : null}

        {isOwner ? (
          <>
            <h2 className="mb-2.5 px-1 text-[13px] font-bold tracking-wide text-ink-500 uppercase">
              Add someone
            </h2>
            <Card className="p-4">
              {/*
                Plenty of crew have no work email, never read it, or have not set
                it up on the phone they are holding. "Check your inbox for a
                link" is not an answer when the job starts in ten minutes.
              */}
              <div className="mb-3.5 flex gap-1.5 rounded-xl bg-ink-100 p-1">
                {(
                  [
                    ['invite', 'Email an invitation'],
                    ['direct', 'Give them a password'],
                  ] as const
                ).map(([option, label]) => (
                  <button
                    key={option}
                    type="button"
                    aria-pressed={mode === option}
                    onClick={() => {
                      setMode(option);
                      setError(null);
                      setSent(null);
                      setAdded(null);
                    }}
                    className={cx(
                      'flex-1 rounded-lg px-2 py-2 text-[13px] font-semibold transition-colors',
                      mode === option
                        ? 'bg-white text-ink-900 shadow-sm'
                        : 'text-ink-600 active:bg-ink-200',
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <form onSubmit={invite} className="flex flex-col gap-3">
                <Field label="Email address">
                  <TextInput
                    type="email"
                    inputMode="email"
                    autoCapitalize="none"
                    autoCorrect="off"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="name@company.com"
                    required
                  />
                </Field>

                {mode === 'direct' ? (
                  <>
                    <Field label="Name" hint="Optional — shown on the roster and on reports.">
                      <TextInput
                        value={fullName}
                        onChange={(event) => setFullName(event.target.value)}
                        placeholder="Sam Okafor"
                      />
                    </Field>
                    <PasswordField
                      label="Temporary password"
                      value={newPassword}
                      onChange={setNewPassword}
                      email={email}
                    />
                  </>
                ) : null}

                <div>
                  <p className="mb-1.5 text-[13px] font-semibold text-ink-700">Role</p>
                  <div className="flex flex-col gap-1.5">
                    {INVITABLE.map((option) => (
                      <button
                        key={option}
                        type="button"
                        aria-pressed={role === option}
                        onClick={() => setRole(option)}
                        className={cx(
                          'rounded-xl border-2 px-3 py-2 text-left transition-colors',
                          role === option
                            ? 'border-brand-600 bg-brand-50'
                            : 'border-ink-200 bg-white active:bg-ink-50',
                        )}
                      >
                        <p
                          className={cx(
                            'text-[14px] font-bold',
                            role === option ? 'text-brand-800' : 'text-ink-900',
                          )}
                        >
                          {ROLE_LABELS[option]}
                        </p>
                        <p className="text-[12px] text-ink-500">{ROLE_HELP[option]}</p>
                      </button>
                    ))}
                  </div>
                </div>

                <Button
                  type="submit"
                  block
                  disabled={sending || !email.trim() || (mode === 'direct' && !newPassword)}
                >
                  {sending
                    ? mode === 'invite'
                      ? 'Sending…'
                      : 'Creating…'
                    : mode === 'invite'
                      ? 'Send invitation'
                      : 'Create account'}
                </Button>
              </form>

              {sent ? (
                <p className="mt-3 rounded-lg bg-pass-50 px-3 py-2 text-[13px] font-medium text-pass-700">
                  Invitation sent to {sent}. They have 14 days to take it up, and the address on
                  the invitation is the one they have to sign up with.
                </p>
              ) : null}

              {added ? <HandOver email={added.email} password={added.password} /> : null}
            </Card>
          </>
        ) : (
          <p className="mb-3 px-1 text-[13px] text-ink-500">
            Only an owner can invite people or change roles. This is the company as it stands.
          </p>
        )}

        {invites.length > 0 ? (
          <>
            <h2 className="mt-8 mb-2.5 px-1 text-[13px] font-bold tracking-wide text-ink-500 uppercase">
              Waiting to accept ({invites.length})
            </h2>
            <div className="flex flex-col gap-2">
              {invites.map((invitation) => {
                const expired = new Date(invitation.expiresAt).getTime() < Date.now();
                return (
                  <Card key={invitation.id} className="flex items-center gap-3 p-3.5">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[14px] font-semibold text-ink-900">
                        {invitation.email}
                      </p>
                      <p className="text-xs text-ink-500">
                        {ROLE_LABELS[invitation.role]} · invited {relativeTime(invitation.createdAt)}
                        {expired ? ' · expired' : ` · expires ${formatDate(invitation.expiresAt)}`}
                      </p>
                    </div>
                    {expired ? <Badge tone="warn">Expired</Badge> : null}
                    {isOwner ? (
                      <button
                        type="button"
                        onClick={() => void withdraw(invitation)}
                        aria-label={`Withdraw the invitation to ${invitation.email}`}
                        className="flex size-9 shrink-0 items-center justify-center rounded-xl text-ink-400 active:bg-ink-100"
                      >
                        <TrashIcon className="size-4" />
                      </button>
                    ) : null}
                  </Card>
                );
              })}
            </div>
          </>
        ) : null}

        <h2 className="mt-8 mb-2.5 px-1 text-[13px] font-bold tracking-wide text-ink-500 uppercase">
          In the company ({members.length})
        </h2>

        {loading ? (
          <p className="px-1 text-[13px] text-ink-500">Loading…</p>
        ) : (
          <div className="flex flex-col gap-2">
            {members.map((member) => {
              const isSelf = member.id === auth.profile?.id;
              return (
                <Card key={member.id} className="p-3.5">
                  <div className="flex items-center gap-3">
                    <UserIcon className="size-5 shrink-0 text-ink-300" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[14px] font-semibold text-ink-900">
                        {member.fullName || member.email}
                        {isSelf ? <span className="text-ink-400"> · you</span> : null}
                      </p>
                      {member.fullName ? (
                        <p className="truncate text-xs text-ink-500">{member.email}</p>
                      ) : null}
                    </div>
                    <Badge tone={member.role === 'inspector' ? 'neutral' : 'brand'}>
                      {ROLE_LABELS[member.role]}
                    </Badge>
                  </div>

                  {/*
                    Owners can move anybody except themselves. Demoting the last
                    owner would leave a company nobody can administer, and the
                    likeliest way to do that by accident is on your own row.
                  */}
                  {isOwner && !isSelf ? (
                    <div className="mt-2.5 flex gap-1.5">
                      {INVITABLE.map((option) => (
                        <button
                          key={option}
                          type="button"
                          disabled={member.role === option}
                          onClick={() => void changeRole(member, option)}
                          className={cx(
                            'flex-1 rounded-lg border px-2 py-1.5 text-[12px] font-semibold transition-colors',
                            member.role === option
                              ? 'border-brand-200 bg-brand-50 text-brand-700'
                              : 'border-ink-200 bg-white text-ink-600 active:bg-ink-50',
                          )}
                        >
                          {ROLE_LABELS[option]}
                        </button>
                      ))}
                    </div>
                  ) : null}

                  {canResetPassword(me, member) ? (
                    <ResetPassword member={member} isSelf={isSelf} />
                  ) : null}
                </Card>
              );
            })}
          </div>
        )}
      </Screen>
    </>
  );
}

/**
 * A password being handed to somebody else, so it is shown rather than hidden.
 *
 * The usual reason to mask a password field is that somebody may be reading
 * over your shoulder. Here the whole point is that it gets read out loud to the
 * person standing next to you, and a masked field means typing a made-up
 * password twice and hoping. It is a one-time key in any case — the account is
 * flagged so the app asks them to choose their own before showing them anything.
 */
function PasswordField({
  label,
  value,
  onChange,
  email,
  hint = 'They will be asked to choose their own the next time they sign in.',
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  email?: string;
  hint?: string;
}) {
  // Only complain once they have stopped typing something plausible — a rule
  // shouting "too short" at the first character is noise.
  const problem = value.length > 0 ? passwordProblem(value, email) : null;

  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between">
        <p className="text-[13px] font-semibold text-ink-700">{label}</p>
        <button
          type="button"
          onClick={() => onChange(generatePassword())}
          className="text-[12px] font-semibold text-brand-700 underline active:text-brand-800"
        >
          Suggest one
        </button>
      </div>
      <TextInput
        type="text"
        name="temporary-password"
        autoComplete="off"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={`At least ${MIN_PASSWORD} characters`}
      />
      <p
        className={cx(
          'mt-1 text-[12px]',
          problem ? 'font-medium text-fail-700' : 'text-ink-500',
        )}
      >
        {problem ?? hint}
      </p>
    </div>
  );
}

/** The one moment the password can be read out. Shown until it is dismissed. */
function HandOver({ email, password }: { email: string; password: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(password);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // No clipboard permission, or an insecure origin. The password is on
      // screen either way, which is what actually matters here.
    }
  }

  return (
    <div className="mt-3 rounded-xl bg-pass-50 p-3">
      <p className="text-[13px] font-semibold text-pass-700">Account ready for {email}</p>
      <p className="mt-0.5 text-[12px] leading-relaxed text-pass-700/80">
        Give them this password now — it is not stored anywhere you can read it back.
      </p>
      <div className="mt-2 flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-lg bg-white px-3 py-2 font-mono text-[15px] font-semibold text-ink-900 select-all">
          {password}
        </code>
        <Button
          variant="secondary"
          className="shrink-0 px-3 py-2 text-[13px]"
          onClick={() => void copy()}
        >
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
    </div>
  );
}

/**
 * Resetting one person's password, from their row on the roster.
 *
 * Kept collapsed behind a link rather than sitting open on every card: this is
 * the control that hands somebody's account to whoever is holding the phone,
 * and it should take a deliberate tap to reach.
 */
function ResetPassword({ member, isSelf }: { member: Member; isSelf: boolean }) {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function submit() {
    const problem = passwordProblem(password, member.email);
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    setError(null);
    const result = await setMemberPassword(member.id, password);
    if (result.error) {
      setError(result.error);
    } else {
      setDone(password);
      setPassword('');
      setOpen(false);
    }
    setBusy(false);
  }

  if (done) {
    return isSelf ? (
      <p className="mt-2.5 rounded-lg bg-pass-50 px-3 py-2 text-[13px] font-medium text-pass-700">
        Your password has been changed.
      </p>
    ) : (
      <HandOver email={member.email} password={done} />
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-2.5 text-[12px] font-semibold text-ink-500 underline active:text-ink-700"
      >
        {isSelf ? 'Change my password' : 'Set a new password'}
      </button>
    );
  }

  return (
    <div className="mt-3 rounded-xl bg-ink-50 p-3">
      <PasswordField
        label={isSelf ? 'Your new password' : `New password for ${member.fullName || member.email}`}
        value={password}
        onChange={setPassword}
        email={member.email}
        hint={
          isSelf
            ? 'You will stay signed in on this device.'
            : 'They will be asked to choose their own the next time they sign in.'
        }
      />

      {error ? (
        <p className="mt-2 flex items-start gap-1.5 text-[12px] font-medium text-fail-700">
          <AlertIcon className="mt-0.5 size-3.5 shrink-0" />
          <span>{error}</span>
        </p>
      ) : null}

      <div className="mt-2.5 flex gap-2">
        <Button
          variant="secondary"
          className="flex-1 py-2 text-[13px]"
          onClick={() => {
            setOpen(false);
            setPassword('');
            setError(null);
          }}
        >
          Cancel
        </Button>
        <Button
          className="flex-1 py-2 text-[13px]"
          disabled={busy || !password}
          onClick={() => void submit()}
        >
          {busy ? 'Setting…' : 'Set password'}
        </Button>
      </div>
    </div>
  );
}
