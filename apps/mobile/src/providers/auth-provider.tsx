// AuthProvider — exposes IAuthClient methods and session state via React context.
// Inject StubAuthClient now; swap concrete implementation (Supabase, BetterAuth) later.
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { AuthSession, IAuthClient } from '@/clients/auth-client.interface';
import { StubAuthClient } from '@/clients/auth-client.stub';

interface AuthContextValue {
  user: AuthSession | null;
  isLoading: boolean;
  signIn: IAuthClient['signIn'];
  signUp: IAuthClient['signUp'];
  signOut: IAuthClient['signOut'];
}

const AuthContext = createContext<AuthContextValue | null>(null);

// Singleton client — swap implementation here when auth backend is ready
const authClient: IAuthClient = new StubAuthClient();

interface AuthProviderProps {
  children: ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [user, setUser] = useState<AuthSession | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Attempt to restore existing session on mount
    authClient
      .getSession()
      .then(setUser)
      .catch(() => setUser(null))
      .finally(() => setIsLoading(false));

    // Subscribe to auth state changes
    let unsubscribe: (() => void) | undefined;
    try {
      unsubscribe = authClient.onAuthChange((session) => setUser(session));
    } catch {
      // StubAuthClient throws — expected during scaffold phase
    }

    return () => unsubscribe?.();
  }, []);

  const value: AuthContextValue = {
    user,
    isLoading,
    signIn: authClient.signIn.bind(authClient),
    signUp: authClient.signUp.bind(authClient),
    signOut: authClient.signOut.bind(authClient),
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
