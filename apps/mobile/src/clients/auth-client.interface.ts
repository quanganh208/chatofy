// IAuthClient — auth integration contract.
// Implementations: StubAuthClient (dev), SupabaseAuthClient, BetterAuthClient.
export interface AuthSession {
  userId: string;
  accessToken: string;
}

export interface IAuthClient {
  signIn(email: string, password: string): Promise<AuthSession>;
  signUp(email: string, password: string, displayName: string): Promise<AuthSession>;
  signOut(): Promise<void>;
  getSession(): Promise<AuthSession | null>;
  /** Register a listener for auth state changes. Returns unsubscribe fn. */
  onAuthChange(cb: (session: AuthSession | null) => void): () => void;
}
