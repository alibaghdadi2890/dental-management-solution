import {
  owingCountSchema,
  patientExportQuerySchema,
  patientListQuerySchema,
  patientPageSchema,
} from '@dcm/contracts';
import { Controller, Get, Headers, Logger, Query, Res } from '@nestjs/common';
import { ApiProduces } from '@nestjs/swagger';
import type { Response } from 'express';
import { createZodDto, ZodResponse } from 'nestjs-zod';
import { RequirePermission } from '../../../platform/http/route-access';
import { PatientExportService } from '../application/patient-export.service';
import { PatientViewsService } from '../application/patient-views.service';
import { exportLabels, exportLocale } from './export-headers';
import { streamChunks } from './stream-chunks';

class PatientListQueryDto extends createZodDto(patientListQuerySchema) {}
class PatientPageDto extends createZodDto(patientPageSchema) {}
class OwingCountDto extends createZodDto(owingCountSchema) {}
class PatientExportQueryDto extends createZodDto(patientExportQuerySchema) {}

/** A download idle this long (no socket activity) is dropped. */
const EXPORT_IDLE_TIMEOUT_MS = 60_000;

/**
 * The Patients list views that need balances (design Q5, Q4; docs/modules/billing.md). Static
 * two-segment paths only, so `billing.controller.ts`'s `patients/:id/balance` and
 * `patients/:id/adjustments` never capture them. `patient:read` is re-checked by the services.
 */
@Controller('billing/patients')
export class BillingPatientsController {
  private readonly logger = new Logger(BillingPatientsController.name);

  constructor(
    private readonly views: PatientViewsService,
    private readonly exports: PatientExportService,
  ) {}

  /**
   * The same query and page shape as `GET /patients`, plus `view=owing`, `sort=balance`,
   * `view=notSeen` and `lastVisit=never`.
   */
  @Get()
  @RequirePermission('payment:read')
  @ZodResponse({ type: PatientPageDto })
  list(@Query() query: PatientListQueryDto) {
    return this.views.list(query);
  }

  @Get('owing-count')
  @RequirePermission('payment:read')
  @ZodResponse({ type: OwingCountDto })
  owingCount() {
    return this.views.owingCount();
  }

  @Get('not-seen-count')
  @RequirePermission('payment:read')
  @ZodResponse({ type: OwingCountDto })
  notSeenCount() {
    return this.views.notSeenCount();
  }

  /**
   * `text/csv` download, streamed chunk by chunk with backpressure (`streamChunks`). The
   * language is `lang`, else `Accept-Language`. The permission checks, the id snapshot and the
   * first chunk run before any header is set, so they still fail as problem details; a failure
   * after that can only abort the download.
   */
  @Get('export')
  @RequirePermission('payment:read')
  @ApiProduces('text/csv')
  async export(
    @Query() query: PatientExportQueryDto,
    @Headers('accept-language') acceptLanguage: string | undefined,
    @Res() response: Response,
  ): Promise<void> {
    const labels = exportLabels(query.lang ?? exportLocale(acceptLanguage));
    const { fileName, chunks } = await this.exports.open(query, labels);
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
      this.logger.error({ err: error }, 'the patient export failed after the download started');
      response.destroy();
    }
  }
}
