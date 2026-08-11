import { isSupabaseConfigured } from '../lib/supabase';

/**
 * Shown only when the app is running with no backend configured, which also means
 * with no sign-in. That is correct for local development and CI, and wrong for a
 * production deploy — so it is stated in the interface rather than left to be
 * discovered by whoever finds the URL.
 */
export function LocalModeBanner() {
  if (isSupabaseConfigured) return null;

  return (
    <div className="bg-warn-500 text-white no-print">
      <p className="mx-auto w-full max-w-3xl px-3 py-1.5 text-center text-xs font-semibold">
        Local mode — no account required, data stays on this device
      </p>
    </div>
  );
}
