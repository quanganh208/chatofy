import { Controller, Get, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { HealthDto } from './dto/health.dto';

/**
 * GET /health — liveness: 200 while the process is up.
 *
 * There is deliberately no readiness sibling probing the database. A readiness
 * probe earns its keep only by returning a NON-200 when the dependency is down,
 * so the orchestrator stops routing traffic; one that answers 200 either way is
 * indistinguishable from this route plus a wasted round-trip. Nothing deployed
 * here reads a probe yet (no HEALTHCHECK in the Dockerfile, no orchestrator
 * manifest), so the honest shape is one liveness route. Add readiness back with
 * the deploy target that consumes it — that target decides the status code.
 *
 * @Public(): a load balancer carries no token, and a liveness probe that 401s
 * reads as a dead process. Marked per route rather than on the class, so adding
 * a route here does not silently inherit the exemption.
 *
 * NOT wrapped in the success envelope (TransformInterceptor skips `/health*`).
 * Probe consumers rely on a stable raw body shape. Hence plain @ApiOkResponse
 * rather than the envelope helper.
 */
@ApiTags('health')
@Controller('health')
export class HealthController {
  @Get()
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: HealthDto })
  liveness(): HealthDto {
    return { status: 'ok', time: new Date().toISOString() };
  }
}
