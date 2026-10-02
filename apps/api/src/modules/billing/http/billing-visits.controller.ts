import {
  unpaidVisitsSummarySchema,
  visitBalanceSchema,
  visitBalancesQuerySchema,
  visitExportQuerySchema,
  visitFiltersSchema,
  visitListQuerySchema,
  visitPageSchema,
} from '@dcm/contracts';
import { Controller, Get, Headers, Logger, Query, Res } from '@nestjs/common';
import { ApiProduces } from '@nestjs/swagger';
import type { Response } from 'express';
import { createZodDto, ZodResponse } from 'nestjs-zod';
import { RequirePermission } from '../../../platform/http/route-access';
import { BillingService } from '../application/billing.service';
import { VisitViewsService } from '../application/visit-views.service';
import { exportLocale } from './export-headers';
import { streamChunks } from './stream-chunks';
import { visitExportLabels } from './visit-export-headers';

class VisitBalancesQueryDto extends createZodDto(visitBalancesQuerySchema) {}
class VisitBalanceDto extends createZodDto(visitBalanceSchema) {}
class VisitListQueryDto extends createZodDto(visitListQuerySchema) {}
class VisitPageDto extends createZodDto(visitPageSchema) {}
class VisitFiltersDto extends createZodDto(visitFiltersSchema) {}
class UnpaidVisitsSummaryDto extends createZodDto(unpaidVisitsSummarySchema) {}
class VisitExportQueryDto extends createZodDto(visitExportQuerySchema) {}

/** A download idle this long (no socket activity) is dropped. */
const EXPORT_IDLE_TIMEOUT_MS = 60_000;

/**
 * The Visits screen's money (4b, docs/modules/billing.md): per-visit balances, the *Unpaid* tab
 * and the CSV export. Static paths only; registered before `BillingController`, whose
 * `visits/:visitId/summary` would otherwise capture `visits/unpaid/summary`. `visit:read` is
 * re-checked by the services.
 */
@Controller('billing/visits')
export class BillingVisitsController {
  private readonly logger = new Logger(BillingVisitsController.name);

  constructor(
    private readonly billing: BillingService,
    private readonly views: VisitViewsService,
  ) {}

  @Get('balances')
  @RequirePermission('payment:read')
  @ZodResponse({ type: [VisitBalanceDto] })
  balances(@Query() query: VisitBalancesQueryDto) {
    return this.billing.balancesForVisits(query.visitIds);
  }

  @Get('unpaid')
  @RequirePermission('payment:read')
  @ZodResponse({ type: VisitPageDto })
  unpaid(@Query() query: VisitListQueryDto) {
    return this.views.unpaid(query);
  }

  @Get('unpaid/summary')
  @RequirePermission('payment:read')
  @ZodResponse({ type: UnpaidVisitsSummaryDto })
  unpaidSummary(@Query() query: VisitFiltersDto) {
    return this.views.unpaidSummary(query);
  }

  /** `text/csv`, streamed like the patients export; `lang`, else `Accept-Language`. */
  @Get('export')
  @RequirePermission('payment:read')
  @ApiProduces('text/csv')
  async export(
    @Query() query: VisitExportQueryDto,
    @Headers('accept-language') acceptLanguage: string | undefined,
    @Res() response: Response,
  ): Promise<void> {
    const labels = visitExportLabels(query.lang ?? exportLocale(acceptLanguage));
    const { fileName, chunks } = await this.views.open(query, labels);
    const first = await chunks.next();

    response.status(200);
    response.setHeader('Content-Type', 'text/csv; charset=utf-8');
    response.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setTimeout(EXPORT_IDLE_TIMEOUT_MS, () => response.destroy());
    try {
      await streamChunks(response, first, chunks);
    } catch (error) {
      this.logger.error({ err: error }, 'the visits export failed after the download started');
      response.destroy();
    }
  }
}
