import { useState } from 'react';
import { useAuth } from '../lib/auth';
import { Button, Field, TextInput } from '../components/ui';
import { AlertIcon } from '../components/Icons';
import { BrandLockup } from '../components/Brandmark';

const MIN_LENGTH = 10;

/**
 * Where an invitation lands.
 *
 * Following the link signs the account in already — Supabase's invitation link
 * carries a one-time code that establishes a session. What it does not do is
 * give the person a way back in tomorrow, so this is shown before anything
 * else until they have set a password.
 *
 * The `needs_password` flag is set on the account when the invitation is sent
 * and cleared here. Without it the app could not tell an invited account from
 * an established one, and would have to either nag everybody or nobody.
 */
export function SetPasswordScreen() {
  const { profile, setPassword, signOut } = useAuth();
  const [password, setValue] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const tooShort = password.length > 0 && password.length < MIN_LENGTH;
  const mismatch = confirm.length > 0 && confirm !== password;
  const ready = password.length >= MIN_LENGTH && confirm === password;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy || !ready) return;
    setBusy(true);
    setError(null);
    const result = await setPassword(password);
    if (result.error) setError(result.error);
    setBusy(false);
  }

  return (
    <div className="safe-pt safe-pb flex min-h-screen flex-col justify-center bg-white px-5 py-10">
      <div className="mx-auto w-full max-w-sm">
        <div className="mb-8">
          <BrandLockup />
        </div>

        <form onSubmit={submit} className="rounded-2xl border border-ink-200 bg-white p-5" autoComplete="on">
          <h2 className="text-[17px] font-bold text-ink-900">Choose a password</h2>
          <p className="mt-1 text-[13px] leading-relaxed text-ink-600">
            {profile?.organization?.name ? (
              <>
                You have been added to{' '}
                <span className="font-semibold text-ink-900">{profile.organization.name}</span>.
              </>
            ) : (
              'Your account is ready.'
            )}{' '}
            Set a password so you can sign back in on this phone and any other.
          </p>

          <div className="mt-4 flex flex-col gap-3.5">
            <Field label="Password" hint={`At least ${MIN_LENGTH} characters.`}>
              <TextInput
                type="password"
                name="new-password"
                autoComplete="new-password"
                value={password}
                onChange={(event) => setValue(event.target.value)}
                required
              />
            </Field>
            <Field label="Confirm password">
              <TextInput
                type="password"
                name="confirm-password"
                autoComplete="new-password"
                value={confirm}
                onChange={(event) => setConfirm(event.target.value)}
                required
              />
            </Field>

            {tooShort || mismatch || error ? (
              <p className="flex items-start gap-1.5 rounded-xl bg-fail-50 px-3 py-2.5 text-[13px] font-medium text-fail-700">
                <AlertIcon className="mt-0.5 size-4 shrink-0" />
                <span>
                  {error ??
                    (mismatch
                      ? 'Those two do not match.'
                      : `Use at least ${MIN_LENGTH} characters.`)}
                </span>
              </p>
            ) : null}

            <Button type="submit" block disabled={busy || !ready}>
              {busy ? 'Saving…' : 'Set password and continue'}
            </Button>
          </div>
        </form>

        <button
          type="button"
          onClick={() => void signOut()}
          className="mt-5 w-full text-center text-xs text-ink-500 underline"
        >
          Not you? Sign out
        </button>
      </div>
    </div>
  );
}
