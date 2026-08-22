import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'chatofy:isPublic';

/**
 * Opts one route out of JwtAuthGuard.
 *
 * Applied PER ROUTE, never to a controller. A controller-level mark is
 * invisible at the handler it exempts: putting it on AuthController would ship
 * `GET /auth/me` unauthenticated, and nothing in the file where that route is
 * written would say so.
 */
export const Public = (): MethodDecorator => SetMetadata(IS_PUBLIC_KEY, true);
