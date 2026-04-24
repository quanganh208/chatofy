import { Controller, Get } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Env } from '../../config/env.schema';

/**
 * Exposes auth-related metadata routes.
 * Business logic is delegated to AUTH_ADAPTER — not this controller.
 */
@Controller('auth')
export class AuthController {
  constructor(private readonly config: ConfigService<Env, true>) {}

  /** Returns which auth provider is currently active (for client discovery). */
  @Get('providers')
  getProviders(): { provider: string } {
    return { provider: this.config.get('AUTH_PROVIDER', { infer: true }) };
  }
}
