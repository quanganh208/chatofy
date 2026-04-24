// Represents an authenticated session
export interface AuthSession {
  userId: string;
  accessToken: string;
}

// Interface for auth providers — swap StubAuthClient for Supabase/BetterAuth without touching call sites
export interface IAuthClient {
  signIn(email: string, password: string): Promise<AuthSession>;
  signUp(email: string, password: string, displayName: string): Promise<AuthSession>;
  signOut(): Promise<void>;
  getSession(): Promise<AuthSession | null>;
  onAuthChange(callback: (session: AuthSession | null) => void): () => void;
}
