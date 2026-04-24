import { Injectable, NotImplementedException } from '@nestjs/common';
import type {
  AuthAdapter,
  AuthClaims,
  UserIdentity,
} from '../interfaces/auth-adapter.interface.js';

/**
 * Stub adapter used when AUTH_PROVIDER=none.
 * All methods throw NotImplementedException — ensures no auth logic silently passes.
 * Replace by providing a real adapter in auth.module.ts and updating the token binding.
 */
@Injectable()
export class NoopAuthAdapter implements AuthAdapter {
  verifyToken(_token: string): Promise<AuthClaims> {
    throw new NotImplementedException('Auth provider not configured. Set AUTH_PROVIDER env var.');
  }

  getUser(_userId: string): Promise<UserIdentity> {
    throw new NotImplementedException('Auth provider not configured. Set AUTH_PROVIDER env var.');
  }

  issueToken(_userId: string): Promise<string> {
    throw new NotImplementedException('Auth provider not configured. Set AUTH_PROVIDER env var.');
  }
}
