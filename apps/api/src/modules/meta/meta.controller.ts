import { Controller, Get } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { appInfo } from '../../common/app-info';
import { Public } from '../../common/decorators/public.decorator';
import { ApiEnvelopeResponse } from '../../common/swagger/api-envelope-response.helper';
import { Env } from '../../config/env.schema';
import { ServiceDescriptorDto } from './dto/service-descriptor.dto';

/**
 * Root service descriptor at GET / — gives anyone hitting the bare origin
 * (dev, uptime monitor, curious browser) a meaningful, prod-safe identity
 * response instead of a bare 404. No business logic, no secrets — and @Public(),
 * because a bare origin hit has no token by definition.
 */
@ApiTags('meta')
@Controller()
export class MetaController {
  constructor(private readonly config: ConfigService<Env, true>) {}

  @Get()
  @Public()
  @ApiOperation({ summary: 'Service descriptor (name, version, status)' })
  @ApiEnvelopeResponse(ServiceDescriptorDto)
  describe(): ServiceDescriptorDto {
    const isProd =
      this.config.get('NODE_ENV', { infer: true }) === 'production';
    return {
      name: appInfo.name,
      version: appInfo.version,
      description: appInfo.description,
      status: 'ok',
      // Swagger UI is not mounted in production — omit rather than advertise a 404.
      ...(isProd ? {} : { docs: '/docs' }),
    };
  }
}
