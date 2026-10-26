import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { authClient } from '@/clients/auth-client';
import type { AuthClient, AuthMessage, AuthSession } from '@/clients/auth-client.interface';

interface AuthContextValue {
  session: AuthSession | null;
  isLoading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  /** Resolves with what to tell the user; it does not sign them in. */
  signUp: (email: string, password: string, name: string) => Promise<AuthMessage>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

// Tests pass their own AuthClient; the app uses the shared instance.
const defaultClient: AuthClient = authClient;

interface AuthProviderProps {
  children: ReactNode;
  client?: AuthClient;
}

export function AuthProvider({ children, client = defaultClient }: AuthProviderProps) {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    // Subscribed before the first read, so a refresh that ends the session (401)
    // while the store loads still signs the app out.
    const unsubscribe = client.onAuthChange(setSession);

    const init = async () => {
      try {
        const stored = await client.getSession();
        if (!cancelled) setSession(stored);
      } catch {
        if (!cancelled) setSession(null);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    void init();
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [client]);

  const signIn = useCallback(
    async (email: string, password: string) => {
      setSession(await client.signIn(email, password));
    },
    [client],
  );

  /**
   * Begins registration; it does NOT produce a session.
   *
   * Registering creates no account — one exists only once the mailed
   * verification link is followed — so there is nothing to put in the session
   * here. The caller shows the returned message and sends the user to sign in
   * after they have followed the link.
   */
  const signUp = useCallback(
    async (email: string, password: string, name: string) => {
      return client.signUp(email, password, name);
    },
    [client],
  );

  const signOut = useCallback(async () => {
    await client.signOut();
    setSession(null);
  }, [client]);

  // Referentially stable context value — consumers only re-render when the
  // session/loading state actually changes, not on every provider render.
  const value = useMemo(
    () => ({ session, isLoading, signIn, signUp, signOut }),
    [session, isLoading, signIn, signUp, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/** The signed-in session and the sign-in/out actions, for screens. */
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
