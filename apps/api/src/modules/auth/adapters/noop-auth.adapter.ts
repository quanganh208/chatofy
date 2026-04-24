import { NotImplementedException } from '@nestjs/common';
import {
  AuthAdapter,
  AuthClaims,
  UserIdentity,
} from '../interfaces/auth-adapter.interface';

/**
 * Stub auth adapter used when AUTH_PROVIDER=none.
 * All methods throw NotImplementedException — replaced by a real adapter at runtime.
 */
export class NoopAuthAdapter implements AuthAdapter {
  verifyToken(_token: string): Promise<AuthClaims> {
    throw new NotImplementedException('Auth adapter not configured');
  }

  getUser(_userId: string): Promise<UserIdentity> {
    throw new NotImplementedException('Auth adapter not configured');
  }
}
