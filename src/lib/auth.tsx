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
}

const ROLES: Role[] = ['owner', 'admin', 'inspector'];

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

  // The role lives on the profile row, not the JWT, so it is read after sign-in.
  useEffect(() => {
    if (!supabase || !session?.user) {
      setProfile(null);
      return;
    }
    let cancelled = false;
    void supabase
      .from('profiles')
      .select('id, email, full_name, role, active, organizations (id, name, slug)')
      .eq('id', session.user.id)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error || !data) {
          // The signup trigger creates this row; if it is missing, fall back to the
          // least privileged role rather than locking the person out entirely.
          console.warn('Could not load profile, defaulting to inspector', error);
          setProfile({
            id: session.user.id,
            email: session.user.email ?? '',
            fullName: '',
            role: 'inspector',
            active: true,
            organization: null,
          });
          return;
        }
        // PostgREST returns an embedded row as an object, or as a one-element
        // array depending on how it reads the relationship. Take either.
        const embedded = data.organizations;
        const org = (Array.isArray(embedded) ? embedded[0] : embedded) as
          | { id: string; name: string; slug: string }
          | null
          | undefined;
        setProfile({
          id: data.id,
          email: data.email,
          fullName: data.full_name ?? '',
          role: ROLES.includes(data.role as Role) ? (data.role as Role) : 'inspector',
          active: data.active !== false,
          organization: org ? { id: org.id, name: org.name, slug: org.slug } : null,
        });
      });
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
    setProfile(null);
  }, []);

  const value = useMemo<AuthValue>(
    () => ({ ready, enabled: isSupabaseConfigured, session, profile, signIn, signOut }),
    [ready, session, profile, signIn, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider');
  return value;
}
