import { Controller, Get } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.schema.js';

/**
 * Auth controller — minimal stub providing provider discovery endpoint.
 * Full auth routes (login, callback, refresh) will be added per provider.
 */
@Controller('auth')
export class AuthController {
  constructor(private readonly config: ConfigService<Env, true>) {}

  /** Returns the currently configured auth provider name. */
  @Get('providers')
  getProviders(): { provider: string } {
    return { provider: this.config.get('AUTH_PROVIDER', { infer: true }) };
  }
}
