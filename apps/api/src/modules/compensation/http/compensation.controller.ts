import {
  adjustmentSchema,
  agreementSchema,
  changeTermsSchema,
  compensationExportQuerySchema,
  compensationReasonSchema,
  compensationReportSchema,
  compensationStatementSchema,
  createAgreementSchema,
  endAgreementSchema,
  idSchema,
  monthQuerySchema,
  monthSchema,
  myMonthsSchema,
  payoutSchema,
  recordAdjustmentSchema,
  recordPayoutSchema,
} from '@dcm/contracts';
import { Body, Controller, Get, Headers, HttpCode, Param, Post, Query, Res } from '@nestjs/common';
import { ApiHeader, ApiProduces } from '@nestjs/swagger';
import type { Response } from 'express';
import { createZodDto, ZodResponse } from 'nestjs-zod';
import { z } from 'zod';
import { idempotencyKey } from '../../../platform/http/idempotency-key';
import { RequirePermission } from '../../../platform/http/route-access';
import { type CsvFile, CompensationService } from '../application/compensation.service';

class AgreementDto extends createZodDto(agreementSchema) {}
class AgreementListDto extends createZodDto(z.array(agreementSchema)) {}
class CreateAgreementDto extends createZodDto(createAgreementSchema) {}
class ChangeTermsDto extends createZodDto(changeTermsSchema) {}
class EndAgreementDto extends createZodDto(endAgreementSchema) {}
class AdjustmentDto extends createZodDto(adjustmentSchema) {}
class RecordAdjustmentDto extends createZodDto(recordAdjustmentSchema) {}
class PayoutDto extends createZodDto(payoutSchema) {}
class RecordPayoutDto extends createZodDto(recordPayoutSchema) {}
class ReasonDto extends createZodDto(compensationReasonSchema) {}
class StatementDto extends createZodDto(compensationStatementSchema) {}
class ReportDto extends createZodDto(compensationReportSchema) {}
class MonthsDto extends createZodDto(myMonthsSchema) {}
class MonthQueryDto extends createZodDto(monthQuerySchema) {}
class ExportQueryDto extends createZodDto(compensationExportQuerySchema) {}
class DentistParamsDto extends createZodDto(z.object({ profileId: idSchema })) {}
class RowParamsDto extends createZodDto(z.object({ profileId: idSchema, id: idSchema })) {}
class PeriodParamsDto extends createZodDto(z.object({ profileId: idSchema, month: monthSchema })) {}

function sendCsv(response: Response, file: CsvFile): void {
  response.status(200);
  response.setHeader('Content-Type', 'text/csv; charset=utf-8');
  response.setHeader('Content-Disposition', `attachment; filename="${file.fileName}"`);
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.send(file.body);
}

/**
 * Dentist compensation, managed by the clinic (feature 13b, docs/modules/compensation.md):
 * agreements, adjustments, payouts, statements, closing months and the report all need
 * `compensation:manage`.
 */
@Controller('compensation')
export class CompensationController {
  constructor(private readonly compensation: CompensationService) {}

  @Get('dentists/:profileId/agreements')
  @RequirePermission('compensation:manage')
  @ZodResponse({ type: AgreementListDto })
  agreements(@Param() params: DentistParamsDto) {
    return this.compensation.listAgreements(params.profileId);
  }

  @Post('dentists/:profileId/agreements')
  @RequirePermission('compensation:manage')
  @ZodResponse({ status: 201, type: AgreementDto })
  createAgreement(@Param() params: DentistParamsDto, @Body() body: CreateAgreementDto) {
    return this.compensation.createAgreement(params.profileId, body);
  }

  @Post('dentists/:profileId/agreements/change-terms')
  @RequirePermission('compensation:manage')
  @ZodResponse({ status: 201, type: AgreementDto })
  changeTerms(@Param() params: DentistParamsDto, @Body() body: ChangeTermsDto) {
    return this.compensation.changeTerms(params.profileId, body);
  }

  @Post('dentists/:profileId/agreements/:id/end')
  @HttpCode(200)
  @RequirePermission('compensation:manage')
  @ZodResponse({ status: 200, type: AgreementDto })
  endAgreement(@Param() params: RowParamsDto, @Body() body: EndAgreementDto) {
    return this.compensation.endAgreement(params.profileId, params.id, body);
  }

  @Get('dentists/:profileId/statement')
  @RequirePermission('compensation:manage')
  @ZodResponse({ type: StatementDto })
  statement(@Param() params: DentistParamsDto, @Query() query: MonthQueryDto) {
    return this.compensation.statement(params.profileId, query.month);
  }

  @Get('dentists/:profileId/statement/export')
  @RequirePermission('compensation:manage')
  @ApiProduces('text/csv')
  async exportStatement(
    @Param() params: DentistParamsDto,
    @Query() query: ExportQueryDto,
    @Res() response: Response,
  ): Promise<void> {
    sendCsv(response, await this.compensation.exportStatement(params.profileId, query));
  }

  @Post('dentists/:profileId/adjustments')
  @RequirePermission('compensation:manage')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ZodResponse({ status: 201, type: AdjustmentDto })
  recordAdjustment(
    @Param() params: DentistParamsDto,
    @Body() body: RecordAdjustmentDto,
    @Headers('idempotency-key') key: string | undefined,
  ) {
    return this.compensation.recordAdjustment(params.profileId, body, idempotencyKey(key));
  }

  @Post('dentists/:profileId/adjustments/:id/void')
  @HttpCode(200)
  @RequirePermission('compensation:manage')
  @ZodResponse({ status: 200, type: AdjustmentDto })
  voidAdjustment(@Param() params: RowParamsDto, @Body() body: ReasonDto) {
    return this.compensation.voidAdjustment(params.profileId, params.id, body);
  }

  @Post('dentists/:profileId/payouts')
  @RequirePermission('compensation:manage')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ZodResponse({ status: 201, type: PayoutDto })
  recordPayout(
    @Param() params: DentistParamsDto,
    @Body() body: RecordPayoutDto,
    @Headers('idempotency-key') key: string | undefined,
  ) {
    return this.compensation.recordPayout(params.profileId, body, idempotencyKey(key));
  }

  @Post('dentists/:profileId/payouts/:id/void')
  @HttpCode(200)
  @RequirePermission('compensation:manage')
  @ZodResponse({ status: 200, type: PayoutDto })
  voidPayout(@Param() params: RowParamsDto, @Body() body: ReasonDto) {
    return this.compensation.voidPayout(params.profileId, params.id, body);
  }

  @Post('dentists/:profileId/periods/:month/close')
  @HttpCode(200)
  @RequirePermission('compensation:manage')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ZodResponse({ status: 200, type: StatementDto })
  close(@Param() params: PeriodParamsDto, @Headers('idempotency-key') key: string | undefined) {
    return this.compensation.closePeriod(params.profileId, params.month, idempotencyKey(key));
  }

  @Post('dentists/:profileId/periods/:month/reopen')
  @HttpCode(200)
  @RequirePermission('compensation:manage')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ZodResponse({ status: 200, type: StatementDto })
  reopen(
    @Param() params: PeriodParamsDto,
    @Body() body: ReasonDto,
    @Headers('idempotency-key') key: string | undefined,
  ) {
    return this.compensation.reopenPeriod(
      params.profileId,
      params.month,
      body,
      idempotencyKey(key),
    );
  }

  @Get('report')
  @RequirePermission('compensation:manage')
  @ZodResponse({ type: ReportDto })
  report(@Query() query: MonthQueryDto) {
    return this.compensation.report(query.month);
  }

  @Get('report/export')
  @RequirePermission('compensation:manage')
  @ApiProduces('text/csv')
  async exportReport(@Query() query: ExportQueryDto, @Res() response: Response): Promise<void> {
    sendCsv(response, await this.compensation.exportReport(query));
  }

  /** The caller's own statement (`compensation:read`); 404 when hidden or without agreement. */
  @Get('me/statement')
  @RequirePermission('compensation:read')
  @ZodResponse({ type: StatementDto })
  myStatement(@Query() query: MonthQueryDto) {
    return this.compensation.myStatement(query.month);
  }

  /** The months the caller may read, newest first (drives the My statement nav item). */
  @Get('me/months')
  @RequirePermission('compensation:read')
  @ZodResponse({ type: MonthsDto })
  myMonths() {
    return this.compensation.myMonths();
  }
}
