import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * The app is local-first and runs perfectly well with no backend — that is how it
 * works offline, and how the dev server and CI smoke test run. Supabase is layered
 * on top: when these two variables are present the app requires a sign-in, and when
 * they are absent it stays in local-only mode.
 *
 * That fallback is deliberate but it is also a footgun: a production deploy missing
 * these variables would silently have no authentication. `LocalModeBanner` makes
 * that state visible in the UI rather than letting it pass unnoticed.
 *
 * Only the publishable key belongs here. It ships inside the client bundle by
 * design and is safe to expose — row-level security is what protects the data. The
 * service_role key must never appear in this file or any other client code.
 */
const url = import.meta.env.VITE_SUPABASE_URL?.trim();
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();

export const isSupabaseConfigured = Boolean(url && publishableKey);

export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(url!, publishableKey!, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        // The app is a PWA opened from the home screen; keep people signed in.
        storageKey: 'qc2go.auth',
        /**
         * PKCE rather than the default implicit flow, and not for the usual
         * reasons — this app routes with `HashRouter`.
         *
         * The implicit flow returns the session in the URL fragment
         * (`#access_token=...`), which is the same fragment HashRouter uses for
         * `#/customers/123`. The two collide: whichever reads it first wins,
         * and an invitation link would either sign nobody in or navigate
         * nowhere. PKCE returns `?code=` in the query string instead, which
         * nothing else is competing for.
         */
        flowType: 'pkce',
        detectSessionInUrl: true,
      },
    })
  : null;

/** Turns Supabase's terser auth errors into something an inspector can act on. */
export function authErrorMessage(message: string): string {
  const text = message.toLowerCase();
  if (text.includes('invalid login credentials')) {
    return 'That email and password combination was not recognised.';
  }
  if (text.includes('email not confirmed')) {
    return 'This account still needs its email confirmed. Check your inbox, or ask an admin to confirm it.';
  }
  if (text.includes('failed to fetch') || text.includes('network')) {
    return 'Could not reach the server. Check your signal — inspections you have already started still work offline.';
  }
  if (text.includes('rate limit') || text.includes('too many')) {
    return 'Too many attempts. Wait a minute and try again.';
  }
  return message;
}
