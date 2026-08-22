import { NotImplementedException } from '@nestjs/common';
import {
  AuthAdapter,
  AuthClaims,
  UserIdentity,
} from '../interfaces/auth-adapter.interface';

/**
 * Placeholder AUTH_ADAPTER binding. Every method throws.
 *
 * Nothing ever selected this by configuration — AuthModule binds it
 * unconditionally, which is why it can only be removed in the same change that
 * binds a real adapter in its place.
 */
export class NoopAuthAdapter implements AuthAdapter {
  async verifyToken(_token: string): Promise<AuthClaims> {
    throw new NotImplementedException('Auth adapter not configured');
  }

  async getUser(_userId: string): Promise<UserIdentity> {
    throw new NotImplementedException('Auth adapter not configured');
  }
}
