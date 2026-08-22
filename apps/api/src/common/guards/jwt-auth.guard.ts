import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import {
  AUTH_ADAPTER,
  type AuthAdapter,
} from '../../modules/auth/interfaces/auth-adapter.interface';

/** Pulls the credential out of `Authorization: Bearer <token>`. */
function bearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header) return null;
  const [scheme, token] = header.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !token) return null;
  return token;
}

/**
 * Requires a verified access token, and records who it belongs to.
 *
 * Reads @Public() from the handler only — deliberately not from the controller.
 * `getAllAndOverride` over both would let a class-level mark exempt routes that
 * never asked for it, which is exactly how `GET /auth/me` would ship open.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(AUTH_ADAPTER) private readonly auth: AuthAdapter,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // WebSocket connections are already refused at the HTTP upgrade by the
    // gateway's verifyClient, before a socket exists — so by the time a frame
    // reaches a handler its connection is authenticated. Returning true here
    // rather than re-checking mirrors how the other global providers bail out
    // of non-HTTP context.
    if (context.getType() !== 'http') return true;

    if (this.reflector.get<boolean>(IS_PUBLIC_KEY, context.getHandler())) {
      return true;
    }

    const req = context.switchToHttp().getRequest<Request>();
    const token = bearerToken(req);
    if (!token) throw new UnauthorizedException('Missing access token');

    const claims = await this.auth.verifyToken(token);
    req.auth = { userId: claims.sub };
    return true;
  }
}
