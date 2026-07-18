// Auth session shape comes from the shared contract (@chatofy/types):
// { user: User, token: AuthToken } — the same shape the api's auth endpoints
// return, so a real client can pass responses through unchanged.
import type { AuthSession } from '@chatofy/types';

export type { AuthSession };

// Interface for auth providers — swap StubAuthClient for Supabase/BetterAuth without touching call sites
export interface AuthClient {
  signIn(email: string, password: string): Promise<AuthSession>;
  signUp(email: string, password: string, displayName: string): Promise<AuthSession>;
  signOut(): Promise<void>;
  getSession(): Promise<AuthSession | null>;
  onAuthChange(callback: (session: AuthSession | null) => void): () => void;
}
