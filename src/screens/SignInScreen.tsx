import { useState } from 'react';
import { useAuth } from '../lib/auth';
import { Button, Field, TextInput } from '../components/ui';
import { AlertIcon } from '../components/Icons';

export function SignInScreen() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    const result = await signIn(email, password);
    if (result.error) setError(result.error);
    setBusy(false);
  }

  return (
    <div className="safe-pt safe-pb flex min-h-screen flex-col justify-center bg-ink-900 px-5 py-10">
      <div className="mx-auto w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-bold tracking-tight text-white">QC2GO</h1>
          <p className="mt-1 text-sm text-white/60">Quality in motion</p>
        </div>

        <form
          onSubmit={submit}
          className="rounded-2xl bg-white p-5"
          // Let password managers recognise this as a sign-in form.
          autoComplete="on"
        >
          <div className="flex flex-col gap-3.5">
            <Field label="Email">
              <TextInput
                type="email"
                name="email"
                autoComplete="username"
                inputMode="email"
                autoCapitalize="none"
                autoCorrect="off"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@company.com"
                required
              />
            </Field>
            <Field label="Password">
              <TextInput
                type="password"
                name="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
            </Field>

            {error ? (
              <p className="flex items-start gap-1.5 rounded-xl bg-fail-50 px-3 py-2.5 text-[13px] font-medium text-fail-700">
                <AlertIcon className="mt-0.5 size-4 shrink-0" />
                <span>{error}</span>
              </p>
            ) : null}

            <Button type="submit" block disabled={busy || !email.trim() || !password}>
              {busy ? 'Signing in…' : 'Sign in'}
            </Button>
          </div>
        </form>

        <p className="mt-5 text-center text-xs leading-relaxed text-white/50">
          Accounts are created by an administrator. If you cannot get in, ask them to check
          your account rather than signing up again.
        </p>
      </div>
    </div>
  );
}
