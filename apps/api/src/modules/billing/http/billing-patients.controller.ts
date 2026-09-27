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

class PatientListQueryDto extends createZodDto(patientListQuerySchema) {}
class PatientPageDto extends createZodDto(patientPageSchema) {}
class OwingCountDto extends createZodDto(owingCountSchema) {}
class PatientExportQueryDto extends createZodDto(patientExportQuerySchema) {}

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

  /** The same query and page shape as `GET /patients`, plus `view=owing` and `sort=balance`. */
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

  /**
   * `text/csv` download, streamed page by page with backpressure. The permission checks and the
   * first page run before any header is set, so they still fail as problem details; a failure
   * after that can only abort the download.
   *
   * The chunks are pulled by this handler's own loop rather than by a piped `Readable`: stream
   * callbacks run outside the request's async context, where the tenant (CLS) is unknown.
   */
  @Get('export')
  @RequirePermission('payment:read')
  @ApiProduces('text/csv')
  async export(
    @Query() query: PatientExportQueryDto,
    @Headers('accept-language') acceptLanguage: string | undefined,
    @Res() response: Response,
  ): Promise<void> {
    const chunks = this.exports.stream(query, exportLabels(exportLocale(acceptLanguage)));
    const first = await chunks.next();
    const fileName = await this.exports.fileName();

    response.status(200);
    response.setHeader('Content-Type', 'text/csv; charset=utf-8');
    response.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    response.setHeader('Cache-Control', 'no-store');
    try {
      for (let next = first; next.done !== true; next = await chunks.next()) {
        if (response.destroyed) {
          await chunks.return(undefined);
          return;
        }
        await write(response, next.value);
      }
      response.end();
    } catch (error) {
      this.logger.error({ err: error }, 'the patient export failed after the download started');
      response.destroy();
    }
  }
}

/** Writes one chunk, waiting for the socket to drain (or close) when its buffer is full. */
function write(response: Response, chunk: string): Promise<void> {
  if (response.write(chunk)) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      response.off('drain', done);
      response.off('close', done);
      resolve();
    };
    response.on('drain', done);
    response.on('close', done);
  });
}
