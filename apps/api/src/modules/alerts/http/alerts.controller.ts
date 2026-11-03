import { ALERT_TRAY_EVENT, alertFollowsInputSchema, alertTraySchema } from '@dcm/contracts';
import { Body, Controller, Get, type MessageEvent, Put, Sse } from '@nestjs/common';
import { createZodDto, ZodResponse } from 'nestjs-zod';
import { Observable } from 'rxjs';
import { z } from 'zod';
import { RequestContext } from '../../../platform/cls/request-context';
import { RequirePermission } from '../../../platform/http/route-access';
import { AlertHub } from '../application/alert-hub';
import { AlertsService } from '../application/alerts.service';

class AlertTrayDto extends createZodDto(alertTraySchema) {}
class AlertFollowsDto extends createZodDto(alertFollowsInputSchema) {}
class AlertFollowsResultDto extends createZodDto(z.object({ dentistIds: z.array(z.uuid()) })) {}

/** Under Cloudflare's 100 s idle cut, with room to spare (ADR-0073). */
export const HEARTBEAT_MS = 25_000;

/** Arrival alerts (feature 15, docs/modules/alerts.md): the tray, the follows and the stream. */
@Controller('alerts')
export class AlertsController {
  constructor(
    private readonly alerts: AlertsService,
    private readonly hub: AlertHub,
    private readonly context: RequestContext,
  ) {}

  @Get('tray')
  @RequirePermission('visit:write')
  @ZodResponse({ type: AlertTrayDto })
  tray() {
    return this.alerts.tray();
  }

  @Put('follows')
  @RequirePermission('visit:write')
  @ZodResponse({ type: AlertFollowsResultDto })
  async follows(@Body() body: AlertFollowsDto) {
    return { dentistIds: await this.alerts.setFollows(body) };
  }

  /**
   * Server-sent events: `tray` when the caller's tray may have changed (D6), and a `ping` every
   * 25 s that keeps proxies from closing the connection. The tenant is taken once, here; the
   * stream ends with the connection.
   */
  @Sse('stream')
  @RequirePermission('visit:write')
  stream(): Observable<MessageEvent> {
    const tenantId = this.context.requireTenantId();
    return new Observable<MessageEvent>((subscriber) => {
      const unsubscribe = this.hub.subscribe(tenantId, () => {
        subscriber.next({ type: ALERT_TRAY_EVENT, data: '' });
      });
      const heartbeat = setInterval(() => {
        subscriber.next({ type: 'ping', data: '' });
      }, HEARTBEAT_MS);
      return () => {
        clearInterval(heartbeat);
        unsubscribe();
      };
    });
  }
}
