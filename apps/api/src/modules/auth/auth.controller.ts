import { Controller } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

/**
 * Auth routes.
 *
 * Deliberately empty right now: `GET /auth/providers` was deleted along with the
 * AUTH_PROVIDER env var it echoed — the value gated nothing and no client
 * branched on it. The controller itself stays because register/login/me land
 * here next; do not delete it as dead code.
 */
@ApiTags('auth')
@Controller('auth')
export class AuthController {}
