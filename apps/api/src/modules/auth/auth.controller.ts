import { Controller, Get } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiEnvelopeResponse } from '../../common/swagger/api-envelope-response.helper';
import { Env } from '../../config/env.schema';
import { AuthProvidersDto } from './dto/auth-providers.dto';

/**
 * Exposes auth-related metadata routes.
 * Business logic is delegated to AUTH_ADAPTER — not this controller.
 */
@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly config: ConfigService<Env, true>) {}

  /** Returns which auth provider is currently active (for client discovery). */
  @Get('providers')
  @ApiOperation({ summary: 'Get the active auth provider' })
  @ApiEnvelopeResponse(AuthProvidersDto)
  getProviders(): { provider: string } {
    // Raw payload — TransformInterceptor wraps it in the success envelope.
    return { provider: this.config.get('AUTH_PROVIDER', { infer: true }) };
  }
}
