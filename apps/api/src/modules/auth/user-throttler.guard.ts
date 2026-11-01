import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { Request } from 'express';

/**
 * A throttler that counts per AUTHENTICATED USER, not per client address.
 *
 * For a guarded route the IP is the wrong key, for the reason `POST /auth/refresh`
 * spells out: every web request arrives from the Next server, so a per-IP limit is
 * one cap shared by the whole web user base. The user id is also the key that
 * matters for abuse — someone holding a stolen access token guesses the current
 * password from wherever they like, and it is the ACCOUNT those guesses must be
 * bounded against.
 *
 * Only correct on a guarded route. The global `JwtAuthGuard` runs before any
 * controller guard and sets `req.auth`; the address fallback exists so a route
 * mistakenly marked `@Public()` is still limited rather than unlimited.
 */
@Injectable()
export class UserThrottlerGuard extends ThrottlerGuard {
  protected override async getTracker(req: Request): Promise<string> {
    const userId = req.auth?.userId;
    return userId ? `user:${userId}` : `ip:${req.ip ?? 'unknown'}`;
  }
}
