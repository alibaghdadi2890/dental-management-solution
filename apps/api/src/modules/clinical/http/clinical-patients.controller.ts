import {
  clinicalSummarySchema,
  idSchema,
  lastVisitSchema,
  patientChartSchema,
  toothCodeSchema,
  toothHistorySchema,
} from '@dcm/contracts';
import { Controller, Get, Param, Res } from '@nestjs/common';
import { ApiExtraModels, ApiOkResponse, getSchemaPath } from '@nestjs/swagger';
import type { Response } from 'express';
import { createZodDto, ZodResponse } from 'nestjs-zod';
import { z } from 'zod';
import { RequirePermission } from '../../../platform/http/route-access';
import { ChartService } from '../application/chart.service';

class PatientChartDto extends createZodDto(patientChartSchema) {}
class ToothHistoryDto extends createZodDto(toothHistorySchema) {}
/** The visit shape only: a DTO can't be nullable, so the route's schema adds the `null`. */
class LastVisitDto extends createZodDto(lastVisitSchema.unwrap()) {}
/** `Output` builds a new class on every read; the route registers and references this one. */
const LastVisitOutput = LastVisitDto.Output;
class ClinicalSummaryDto extends createZodDto(clinicalSummarySchema) {}
class PatientParamsDto extends createZodDto(z.object({ id: idSchema })) {}
/** A code that is not one of the 52 FDI codes → 400. */
class ToothParamsDto extends createZodDto(z.object({ id: idSchema, toothCode: toothCodeSchema })) {}

/**
 * A patient's clinical record (docs/modules/clinical.md, spec §HTTP): the chart, one tooth's
 * history, the Last visit card and the treatment summary. Read-only, so front desk sees them too.
 */
@Controller('clinical/patients')
export class ClinicalPatientsController {
  constructor(private readonly chart: ChartService) {}

  @Get(':id/chart')
  @RequirePermission('visit:read')
  @ZodResponse({ type: PatientChartDto })
  getChart(@Param() params: PatientParamsDto) {
    return this.chart.chart(params.id);
  }

  @Get(':id/teeth/:toothCode/history')
  @RequirePermission('visit:read')
  @ZodResponse({ type: ToothHistoryDto })
  toothHistory(@Param() params: ToothParamsDto) {
    return this.chart.toothHistory(params.id, params.toothCode);
  }

  /**
   * `null` when the patient has no completed visit. Nest answers a `null` result with an empty
   * body, so this route writes the JSON itself: the contract's `null` must arrive as `null`. An
   * answer that breaks the contract is a server bug (500), never the caller's 400.
   */
  @Get(':id/last-visit')
  @RequirePermission('visit:read')
  @ApiExtraModels(LastVisitOutput)
  @ApiOkResponse({
    description: 'The last completed visit, or null when there is none',
    schema: { nullable: true, allOf: [{ $ref: getSchemaPath(LastVisitOutput) }] },
  })
  async lastVisit(@Param() params: PatientParamsDto, @Res() response: Response): Promise<void> {
    const lastVisit = lastVisitSchema.safeParse(await this.chart.lastVisit(params.id));
    if (!lastVisit.success) {
      throw new Error('the last visit does not match its contract', { cause: lastVisit.error });
    }
    response.json(lastVisit.data);
  }

  @Get(':id/summary')
  @RequirePermission('visit:read')
  @ZodResponse({ type: ClinicalSummaryDto })
  summary(@Param() params: PatientParamsDto) {
    return this.chart.summary(params.id);
  }
}
