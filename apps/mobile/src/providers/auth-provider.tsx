import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import { StubAuthClient } from '@/clients/auth-client.stub';
import type { IAuthClient, AuthSession } from '@/clients/auth-client.interface';

interface AuthContextValue {
  user: AuthSession | null;
  isLoading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, displayName: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

// Swap client by passing a different IAuthClient implementation as prop
const defaultClient: IAuthClient = new StubAuthClient();

interface AuthProviderProps {
  children: ReactNode;
  client?: IAuthClient;
}

export function AuthProvider({ children, client = defaultClient }: AuthProviderProps) {
  const [user, setUser] = useState<AuthSession | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let unsubscribe: (() => void) | undefined;

    const init = async () => {
      try {
        const session = await client.getSession();
        setUser(session);
      } catch {
        setUser(null);
      } finally {
        setIsLoading(false);
      }

      try {
        unsubscribe = client.onAuthChange((session) => setUser(session));
      } catch {
        // stub throws — acceptable in scaffold
      }
    };

    init();
    return () => unsubscribe?.();
  }, [client]);

  const signIn = async (email: string, password: string) => {
    const session = await client.signIn(email, password);
    setUser(session);
  };

  const signUp = async (email: string, password: string, displayName: string) => {
    const session = await client.signUp(email, password, displayName);
    setUser(session);
  };

  const signOut = async () => {
    await client.signOut();
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, isLoading, signIn, signUp, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
