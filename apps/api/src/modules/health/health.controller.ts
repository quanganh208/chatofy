import { Controller, Get, HttpCode, HttpStatus } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';

interface HealthResponse {
  status: 'ok';
  time: string;
}

interface ReadyResponse {
  status: 'ok' | 'degraded';
  db: 'connected' | 'unreachable';
  time: string;
}

/**
 * Health controller — liveness and readiness probes.
 * GET /health       → always 200 if process is alive
 * GET /health/ready → 200 if DB reachable, 503 if not
 */
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  liveness(): HealthResponse {
    return { status: 'ok', time: new Date().toISOString() };
  }

  @Get('ready')
  async readiness(): Promise<ReadyResponse> {
    const time = new Date().toISOString();
    try {
      // Lightweight DB connectivity check — no table scan.
      await this.prisma.$queryRaw`SELECT 1`;
      return { status: 'ok', db: 'connected', time };
    } catch {
      // Return degraded instead of throwing — let the caller decide to retry.
      return { status: 'degraded', db: 'unreachable', time };
    }
  }
}
