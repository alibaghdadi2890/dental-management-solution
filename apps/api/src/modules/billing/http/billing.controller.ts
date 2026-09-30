import {
  adjustmentInputSchema,
  balancesQuerySchema,
  createWithOpeningBalanceSchema,
  idSchema,
  openingBalanceResultSchema,
  patientBalanceSchema,
  visitFinancialSummarySchema,
} from '@dcm/contracts';
import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { createZodDto, ZodResponse } from 'nestjs-zod';
import { z } from 'zod';
import { RequirePermission } from '../../../platform/http/route-access';
import { BillingService } from '../application/billing.service';

class CreateWithOpeningBalanceDto extends createZodDto(createWithOpeningBalanceSchema) {}
class OpeningBalanceResultDto extends createZodDto(openingBalanceResultSchema) {}
class AdjustmentInputDto extends createZodDto(adjustmentInputSchema) {}
class PatientBalanceDto extends createZodDto(patientBalanceSchema) {}
class BalancesQueryDto extends createZodDto(balancesQuerySchema) {}
class PatientParamsDto extends createZodDto(z.object({ id: idSchema })) {}
class VisitParamsDto extends createZodDto(z.object({ visitId: idSchema })) {}
class VisitFinancialSummaryDto extends createZodDto(visitFinancialSummarySchema) {}

/**
 * Opening balances, adjustments, balances and a completed visit's summary
 * (docs/modules/billing.md). The patient views that need balances (`GET /billing/patients`,
 * `/owing-count`, `/export`) live in their own controller; the routes here never share a path
 * shape with them.
 */
@Controller('billing')
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  /** `patient:write` is re-checked by the service (it creates the patient). */
  @Post('opening-balances')
  @RequirePermission('payment:write')
  @ZodResponse({ status: 201, type: OpeningBalanceResultDto })
  createWithOpeningBalance(@Body() body: CreateWithOpeningBalanceDto) {
    return this.billing.createWithOpeningBalance(body);
  }

  @Get('balances')
  @RequirePermission('payment:read')
  @ZodResponse({ type: [PatientBalanceDto] })
  balances(@Query() query: BalancesQueryDto) {
    return this.billing.balancesFor(query.patientIds);
  }

  @Get('patients/:id/balance')
  @RequirePermission('payment:read')
  @ZodResponse({ type: PatientBalanceDto })
  balance(@Param() params: PatientParamsDto) {
    return this.billing.balanceOf(params.id);
  }

  @Post('patients/:id/adjustments')
  @RequirePermission('payment:write')
  @ZodResponse({ status: 201, type: PatientBalanceDto })
  adjust(@Param() params: PatientParamsDto, @Body() body: AdjustmentInputDto) {
    return this.billing.adjustBalance(params.id, body);
  }

  /** `visit:read` is re-checked by the service (the visit's money comes from `clinical`). */
  @Get('visits/:visitId/summary')
  @RequirePermission('payment:read')
  @ZodResponse({ type: VisitFinancialSummaryDto })
  visitSummary(@Param() params: VisitParamsDto) {
    return this.billing.visitSummary(params.visitId);
  }
}
