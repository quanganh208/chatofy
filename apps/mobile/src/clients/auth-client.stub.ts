// StubAuthClient — placeholder IAuthClient that throws on every call.
// Replace with SupabaseAuthClient or BetterAuthClient when auth is wired.
import type { AuthSession, IAuthClient } from './auth-client.interface';

const NOT_IMPLEMENTED =
  'Not implemented: swap in concrete AuthClient (Supabase, BetterAuth, or custom)';

export class StubAuthClient implements IAuthClient {
  signIn(_email: string, _password: string): Promise<AuthSession> {
    throw new Error(NOT_IMPLEMENTED);
  }

  signUp(_email: string, _password: string, _displayName: string): Promise<AuthSession> {
    throw new Error(NOT_IMPLEMENTED);
  }

  signOut(): Promise<void> {
    throw new Error(NOT_IMPLEMENTED);
  }

  getSession(): Promise<AuthSession | null> {
    throw new Error(NOT_IMPLEMENTED);
  }

  onAuthChange(_cb: (session: AuthSession | null) => void): () => void {
    throw new Error(NOT_IMPLEMENTED);
  }
}
