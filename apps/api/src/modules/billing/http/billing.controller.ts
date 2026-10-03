import {
  adjustmentInputSchema,
  balancesQuerySchema,
  createWithOpeningBalanceSchema,
  idSchema,
  openingBalanceResultSchema,
  outstandingPageSchema,
  outstandingQuerySchema,
  patientAccountSchema,
  patientBalanceSchema,
  receivablesSchema,
  statementSchema,
  familySchema,
  familyStatementSchema,
  payerQuerySchema,
  visitFinancialSummarySchema,
} from '@dcm/contracts';
import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { createZodDto, ZodResponse } from 'nestjs-zod';
import { z } from 'zod';
import { RequirePermission } from '../../../platform/http/route-access';
import { BillingService } from '../application/billing.service';
import { PaymentViewsService } from '../application/payment-views.service';

class CreateWithOpeningBalanceDto extends createZodDto(createWithOpeningBalanceSchema) {}
class OpeningBalanceResultDto extends createZodDto(openingBalanceResultSchema) {}
class AdjustmentInputDto extends createZodDto(adjustmentInputSchema) {}
class PatientBalanceDto extends createZodDto(patientBalanceSchema) {}
class BalancesQueryDto extends createZodDto(balancesQuerySchema) {}
class PatientParamsDto extends createZodDto(z.object({ id: idSchema })) {}
class VisitParamsDto extends createZodDto(z.object({ visitId: idSchema })) {}
class VisitFinancialSummaryDto extends createZodDto(visitFinancialSummarySchema) {}
class ReceivablesDto extends createZodDto(receivablesSchema) {}
class OutstandingQueryDto extends createZodDto(outstandingQuerySchema) {}
class OutstandingPageDto extends createZodDto(outstandingPageSchema) {}
class PatientAccountDto extends createZodDto(patientAccountSchema) {}
class StatementDto extends createZodDto(statementSchema) {}
class PayerQueryDto extends createZodDto(payerQuerySchema) {}
class FamilyDto extends createZodDto(familySchema) {}
class FamilyStatementDto extends createZodDto(familyStatementSchema) {}
class ContactParamsDto extends createZodDto(z.object({ id: idSchema })) {}

/**
 * Opening balances, adjustments, balances and a completed visit's summary
 * (docs/modules/billing.md). The patient views that need balances (`GET /billing/patients`,
 * `/owing-count`, `/export`) live in their own controller; the routes here never share a path
 * shape with them.
 */
@Controller('billing')
export class BillingController {
  constructor(
    private readonly billing: BillingService,
    private readonly payments: PaymentViewsService,
  ) {}

  /** The Payments KPI cards and aging bar (feature 5). */
  @Get('aging')
  @RequirePermission('payment:read')
  @ZodResponse({ type: ReceivablesDto })
  aging() {
    return this.payments.receivables();
  }

  /** The Payments › Outstanding tab: owing patients, oldest unpaid first. */
  @Get('outstanding')
  @RequirePermission('payment:read')
  @ZodResponse({ type: OutstandingPageDto })
  outstanding(@Query() query: OutstandingQueryDto) {
    return this.payments.outstanding(query);
  }

  @Get('patients/:id/account')
  @RequirePermission('payment:read')
  @ZodResponse({ type: PatientAccountDto })
  account(@Param() params: PatientParamsDto, @Query() query: PayerQueryDto) {
    return this.payments.account(params.id, query.payerContactId);
  }

  /** A billing contact's family: each account they pay for, and the total (feature 5). */
  @Get('contacts/:id/family')
  @RequirePermission('payment:read')
  @ZodResponse({ type: FamilyDto })
  family(@Param() params: ContactParamsDto) {
    return this.payments.family(params.id);
  }

  @Get('contacts/:id/family/statement')
  @RequirePermission('payment:read')
  @ZodResponse({ type: FamilyStatementDto })
  familyStatement(@Param() params: ContactParamsDto) {
    return this.payments.familyStatement(params.id);
  }

  @Get('patients/:id/statement')
  @RequirePermission('payment:read')
  @ZodResponse({ type: StatementDto })
  statement(@Param() params: PatientParamsDto) {
    return this.payments.statement(params.id);
  }

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
