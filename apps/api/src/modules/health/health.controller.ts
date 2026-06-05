import { Controller, Get, HttpCode, HttpStatus, Logger } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../../prisma/prisma.service';
import { HealthDto } from './dto/health.dto';

interface HealthResponse {
  status: 'ok' | 'degraded';
  time: string;
  db?: 'ok' | 'error';
}

/**
 * Health endpoints consumed by load-balancers and readiness probes.
 *
 * GET /health       — liveness: always returns { status: 'ok' } while process is up
 * GET /health/ready — readiness: probes DB; returns 200 even when degraded so
 *                     Kubernetes does not flap the readiness probe on transient errors.
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
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: HealthDto })
  liveness(): HealthResponse {
    return { status: 'ok', time: new Date().toISOString() };
  }

  @Get('ready')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: HealthDto })
  async readiness(): Promise<HealthResponse> {
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
