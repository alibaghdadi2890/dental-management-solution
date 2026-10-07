import {
  adjustmentInputSchema,
  balancesQuerySchema,
  createWithOpeningBalanceSchema,
  currencyLockSchema,
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
import { Body, Controller, Get, Headers, Param, Post, Query } from '@nestjs/common';
import { ApiHeader } from '@nestjs/swagger';
import { createZodDto, ZodResponse } from 'nestjs-zod';
import { z } from 'zod';
import { idempotencyKey } from '../../../platform/http/idempotency-key';
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
class CurrencyLockDto extends createZodDto(currencyLockSchema) {}
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

  /** Whether the clinic's currency can still change (the admin Settings tab, H6). */
  @Get('currency-lock')
  @RequirePermission('tenant:read')
  @ZodResponse({ type: CurrencyLockDto })
  currencyLock() {
    return this.billing.currencyLock();
  }

  /**
   * `patient:write` is re-checked by the service (it creates the patient). A retry with the same
   * `Idempotency-Key` and body answers with the first patient and its balance (H5).
   */
  @Post('opening-balances')
  @RequirePermission('payment:write')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ZodResponse({ status: 201, type: OpeningBalanceResultDto })
  createWithOpeningBalance(
    @Body() body: CreateWithOpeningBalanceDto,
    @Headers('idempotency-key') key: string | undefined,
  ) {
    return this.billing.createWithOpeningBalance(body, idempotencyKey(key));
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

  /** A retry with the same `Idempotency-Key` and body records nothing new (H5). */
  @Post('patients/:id/adjustments')
  @RequirePermission('payment:refund')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ZodResponse({ status: 201, type: PatientBalanceDto })
  adjust(
    @Param() params: PatientParamsDto,
    @Body() body: AdjustmentInputDto,
    @Headers('idempotency-key') key: string | undefined,
  ) {
    return this.billing.adjustBalance(params.id, body, idempotencyKey(key));
  }

  /** `visit:read` is re-checked by the service (the visit's money comes from `clinical`). */
  @Get('visits/:visitId/summary')
  @RequirePermission('payment:read')
  @ZodResponse({ type: VisitFinancialSummaryDto })
  visitSummary(@Param() params: VisitParamsDto) {
    return this.billing.visitSummary(params.visitId);
  }
}
