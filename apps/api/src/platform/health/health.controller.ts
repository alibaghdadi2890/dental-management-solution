import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import type { Response } from 'express';
import { HealthService, type Readiness } from './health.service';

/** Unauthenticated by design (CLAUDE.md §6): liveness and readiness probes only. */
@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get('live')
  live(): { status: 'ok' } {
    return { status: 'ok' };
  }

  @Get('ready')
  async ready(@Res({ passthrough: true }) response: Response): Promise<Readiness> {
    const readiness = await this.health.readiness();
    if (readiness.status !== 'ok') {
      response.status(HttpStatus.SERVICE_UNAVAILABLE);
    }
    return readiness;
  }
}
