import { Controller, Get, NotFoundException } from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator';
import { ConferenceMetricsService } from './conference-metrics.service';

/**
 * HTTP GET /conference/metrics — benchmark metrics tap.
 *
 * Only available when CONFERENCE_METRICS_ENABLED is on. Returns 404 otherwise so
 * normal production traffic is unaffected and no sensitive data is leaked.
 */
@Controller('conference')
export class ConferenceMetricsController {
  constructor(private readonly metricsService: ConferenceMetricsService) {}

  @Public()
  @Get('metrics')
  getMetrics() {
    if (!this.metricsService.isEnabled()) {
      throw new NotFoundException('Conference metrics are not enabled');
    }
    const snapshot = this.metricsService.getSnapshot();
    if (!snapshot) {
      return {
        status: 'pending',
        message: 'First metrics snapshot not yet collected (wait 2s)',
      };
    }
    return snapshot;
  }
}
