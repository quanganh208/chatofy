import { Controller, Get, HttpCode, HttpStatus, Logger } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { HealthDto } from './dto/health.dto';

/**
 * Health endpoints consumed by load-balancers and readiness probes.
 *
 * GET /health       — liveness: always returns { status: 'ok' } while process is up
 * GET /health/ready — readiness: probes DB; returns 200 even when degraded so
 *                     Kubernetes does not flap the readiness probe on transient errors.
 *
 * Both are @Public(): a load balancer has no token, and a liveness probe that
 * 401s reads as a dead process. Marked per route rather than on the class, so
 * adding a route here does not silently inherit the exemption.
 *
 * NOTE: health responses are intentionally NOT wrapped in the success envelope
 * (TransformInterceptor skips /health*). Probe consumers rely on a stable raw
 * body shape, and a `success:true` wrapper around a `degraded` status would be
 * misleading. Hence plain @ApiOkResponse (not the envelope helper).
 */
@ApiTags('health')
@Controller('health')
export class HealthController {
  private readonly logger = new Logger(HealthController.name);

  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: HealthDto })
  liveness(): HealthDto {
    return { status: 'ok', time: new Date().toISOString() };
  }

  @Get('ready')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: HealthDto })
  async readiness(): Promise<HealthDto> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { status: 'ok', time: new Date().toISOString(), db: 'ok' };
    } catch (err) {
      this.logger.warn('Readiness DB probe failed', err);
      return {
        status: 'degraded',
        time: new Date().toISOString(),
        db: 'error',
      };
    }
  }
}
