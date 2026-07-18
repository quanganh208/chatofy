import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { StubAuthClient } from '@/clients/auth-client.stub';
import type { AuthClient, AuthSession } from '@/clients/auth-client.interface';

interface AuthContextValue {
  session: AuthSession | null;
  isLoading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, displayName: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

// Swap client by passing a different AuthClient implementation as prop
const defaultClient: AuthClient = new StubAuthClient();

interface AuthProviderProps {
  children: ReactNode;
  client?: AuthClient;
}

export function AuthProvider({ children, client = defaultClient }: AuthProviderProps) {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let unsubscribe: (() => void) | undefined;

    const init = async () => {
      try {
        setSession(await client.getSession());
      } catch {
        setSession(null);
      } finally {
        setIsLoading(false);
      }

      try {
        unsubscribe = client.onAuthChange(setSession);
      } catch {
        // stub throws — acceptable in scaffold
      }
    };

    init();
    return () => unsubscribe?.();
  }, [client]);

  const signIn = useCallback(
    async (email: string, password: string) => {
      setSession(await client.signIn(email, password));
    },
    [client],
  );

  const signUp = useCallback(
    async (email: string, password: string, displayName: string) => {
      setSession(await client.signUp(email, password, displayName));
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

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
