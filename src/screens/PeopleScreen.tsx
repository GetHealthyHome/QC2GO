import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../lib/auth';
import {
  inviteMember,
  listMembers,
  listPendingInvites,
  revokeInvite,
  setMemberRole,
  type Invite,
  type Member,
} from '../lib/invites';
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
    setSending(true);
    setError(null);
    setSent(null);

    const result = await inviteMember(email.trim(), role);
    if (result.error) {
      setError(result.error);
    } else {
      setSent(email.trim());
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
              Invite someone
            </h2>
            <Card className="p-4">
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

                <Button type="submit" block disabled={sending || !email.trim()}>
                  {sending ? 'Sending…' : 'Send invitation'}
                </Button>
              </form>

              {sent ? (
                <p className="mt-3 rounded-lg bg-pass-50 px-3 py-2 text-[13px] font-medium text-pass-700">
                  Invitation sent to {sent}. They have 14 days to take it up, and the address on
                  the invitation is the one they have to sign up with.
                </p>
              ) : null}
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
                </Card>
              );
            })}
          </div>
        )}
      </Screen>
    </>
  );
}
