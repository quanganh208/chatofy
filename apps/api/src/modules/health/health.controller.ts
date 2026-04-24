import { Controller, Get, HttpCode, HttpStatus, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

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
 */
@Controller('health')
export class HealthController {
  private readonly logger = new Logger(HealthController.name);

  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  liveness(): HealthResponse {
    return { status: 'ok', time: new Date().toISOString() };
  }

  @Get('ready')
  @HttpCode(HttpStatus.OK)
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
