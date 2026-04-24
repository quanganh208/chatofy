import type { IAuthClient, AuthSession } from './auth-client.interface';

// Placeholder — swap for a concrete Supabase/BetterAuth client before shipping
export class StubAuthClient implements IAuthClient {
  signIn(_email: string, _password: string): Promise<AuthSession> {
    throw new Error('Not implemented: swap concrete AuthClient');
  }

  signUp(_email: string, _password: string, _displayName: string): Promise<AuthSession> {
    throw new Error('Not implemented: swap concrete AuthClient');
  }

  signOut(): Promise<void> {
    throw new Error('Not implemented: swap concrete AuthClient');
  }

  getSession(): Promise<AuthSession | null> {
    throw new Error('Not implemented: swap concrete AuthClient');
  }

  onAuthChange(_callback: (session: AuthSession | null) => void): () => void {
    throw new Error('Not implemented: swap concrete AuthClient');
  }
}
