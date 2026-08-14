import { useAuth } from '../lib/auth';
import { Button } from '../components/ui';
import { AlertIcon } from '../components/Icons';
import { BrandLockup } from '../components/Brandmark';

/**
 * Where an account with no company lands.
 *
 * Every server-side policy compares a row's organization against the caller's,
 * and an uninvited account has none — so every comparison is null and every
 * table comes back empty. That is the safe direction to fail in, but an empty
 * app looks like a broken app. This says which of the two it is.
 */
export function NoOrganizationScreen() {
  const { profile, signOut } = useAuth();

  return (
    <div className="safe-pt safe-pb flex min-h-screen flex-col justify-center bg-white px-5 py-10">
      <div className="mx-auto w-full max-w-sm">
        <div className="mb-8">
          <BrandLockup />
        </div>

        <div className="rounded-2xl border border-ink-200 bg-white p-5">
          <p className="flex items-start gap-1.5 rounded-xl bg-warn-50 px-3 py-2.5 text-[13px] font-medium text-warn-700">
            <AlertIcon className="mt-0.5 size-4 shrink-0" />
            <span>This account is not part of a company yet.</span>
          </p>

          <p className="mt-3 text-[13px] leading-relaxed text-ink-600">
            You are signed in as{' '}
            <span className="font-semibold text-ink-900">{profile?.email}</span>, but nobody has
            invited this address into a company. Ask whoever runs QC2GO where you work to send an
            invitation to it — the invitation has to match this address exactly.
          </p>

          <Button variant="secondary" block className="mt-4" onClick={() => void signOut()}>
            Sign out
          </Button>
        </div>
      </div>
    </div>
  );
}
