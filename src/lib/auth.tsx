import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { Session } from '@supabase/supabase-js';
import { authErrorMessage, isSupabaseConfigured, supabase } from './supabase';
import { profileRepo } from './db';
import type { Organization, Role } from './types';

export interface Profile {
  id: string;
  email: string;
  fullName: string;
  role: Role;
  active: boolean;
  /**
   * The company this account belongs to, or null when nobody has invited it
   * into one. Null is a real state, not an error: every server-side policy
   * compares against it, so an uninvited account sees an empty app rather than
   * somebody else's data.
   */
  organization: Organization | null;
}

interface AuthValue {
  /** False until the initial session lookup has finished, so nothing flashes. */
  ready: boolean;
  /** True when Supabase is wired up and a sign-in is therefore required. */
  enabled: boolean;
  session: Session | null;
  profile: Profile | null;
  signIn: (email: string, password: string) => Promise<{ error?: string }>;
  signOut: () => Promise<void>;
  /** Owners only — the server refuses it from anybody else. */
  updateOrganization: (patch: Partial<Organization>) => Promise<{ error?: string }>;
}

const ROLES: Role[] = ['owner', 'admin', 'inspector'];

/**
 * PostgREST hands back an embedded row as an object or as a one-element array
 * depending on how it reads the relationship. Take either.
 */
function readOrganization(embedded: unknown): Organization | null {
  const row = (Array.isArray(embedded) ? embedded[0] : embedded) as
    | { id: string; name: string; slug: string; logo?: string | null }
    | null
    | undefined;
  if (!row?.id) return null;
  return { id: row.id, name: row.name, slug: row.slug, logo: row.logo ?? null };
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(!isSupabaseConfigured);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);

  useEffect(() => {
    if (!supabase) return;

    let cancelled = false;
    void supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      setSession(data.session);
      setReady(true);
    });

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      setReady(true);
    });

    return () => {
      cancelled = true;
      subscription.subscription.unsubscribe();
    };
  }, []);

  /**
   * The company, the role and the logo live on the profile row rather than in
   * the JWT, so they are read after sign-in — and that read needs a network.
   *
   * The device's last copy is used first and the network answer replaces it when
   * one arrives. Without that, opening the app in a basement would show a
   * signed-in inspector the "no company" screen and an app with nothing in it,
   * which looks exactly like losing a day's work.
   */
  useEffect(() => {
    const userId = session?.user?.id;
    if (!supabase || !session?.user) {
      setProfile(null);
      return;
    }
    let cancelled = false;

    void (async () => {
      const cached = await profileRepo.get<Profile>();
      if (!cancelled && cached && cached.id === userId) setProfile(cached);

      const { data, error } = await supabase!
        .from('profiles')
        .select('id, email, full_name, role, active, organizations (id, name, slug, logo)')
        .eq('id', userId!)
        .maybeSingle();

      if (cancelled) return;

      if (error || !data) {
        // Offline, or the row is genuinely missing. A cached profile for this
        // same account is the better answer than either guess.
        if (cached?.id === userId) return;
        console.warn('Could not load profile, defaulting to inspector', error);
        setProfile({
          id: session.user!.id,
          email: session.user!.email ?? '',
          fullName: '',
          role: 'inspector',
          active: true,
          organization: null,
        });
        return;
      }

      const next: Profile = {
        id: data.id,
        email: data.email,
        fullName: data.full_name ?? '',
        role: ROLES.includes(data.role as Role) ? (data.role as Role) : 'inspector',
        active: data.active !== false,
        organization: readOrganization(data.organizations),
      };
      setProfile(next);
      await profileRepo.put(next);
    })();

    return () => {
      cancelled = true;
    };
  }, [session?.user?.id]);

  const signIn = useCallback<AuthValue['signIn']>(async (email, password) => {
    if (!supabase) return { error: 'Sign-in is not configured on this deployment.' };
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    return error ? { error: authErrorMessage(error.message) } : {};
  }, []);

  const signOut = useCallback(async () => {
    if (!supabase) return;
    await supabase.auth.signOut();
    // The cache outlives the session on purpose everywhere except here: signing
    // out is the one moment somebody is asking for this device to forget them.
    await profileRepo.clear();
    setProfile(null);
  }, []);

  const updateOrganization = useCallback<AuthValue['updateOrganization']>(
    async (patch) => {
      if (!supabase || !profile?.organization) {
        return { error: 'There is no company on this account to change.' };
      }
      const { data, error } = await supabase
        .from('organizations')
        .update({ name: patch.name, logo: patch.logo })
        .eq('id', profile.organization.id)
        .select('id, name, slug, logo')
        .maybeSingle();

      if (error) return { error: error.message };
      if (!data) {
        // The update policy is owner-only, and a refused update matches no rows
        // rather than raising. Silence here would look like it had worked.
        return { error: 'Only an owner can change the company details.' };
      }

      const next: Profile = { ...profile, organization: readOrganization(data) };
      setProfile(next);
      await profileRepo.put(next);
      return {};
    },
    [profile],
  );

  const value = useMemo<AuthValue>(
    () => ({
      ready,
      enabled: isSupabaseConfigured,
      session,
      profile,
      signIn,
      signOut,
      updateOrganization,
    }),
    [ready, session, profile, signIn, signOut, updateOrganization],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider');
  return value;
}
