import {
  createLabSchema,
  createLabServiceSchema,
  idSchema,
  labAccountsSchema,
  labAdjustmentSchema,
  labListQuerySchema,
  labOpeningBalanceSchema,
  labPaymentSchema,
  labReportQuerySchema,
  labReportSchema,
  labSchema,
  labServiceSchema,
  labStatementQuerySchema,
  labStatementSchema,
  patientListQuerySchema,
  patientPageSchema,
  recordLabAdjustmentSchema,
  recordLabPaymentSchema,
  updateLabSchema,
  updateLabServiceSchema,
  voidLabPaymentSchema,
} from '@dcm/contracts';
import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Res,
} from '@nestjs/common';
import { ApiHeader, ApiProduces } from '@nestjs/swagger';
import type { Response } from 'express';
import { createZodDto, ZodResponse } from 'nestjs-zod';
import { z } from 'zod';
import { idempotencyKey } from '../../../platform/http/idempotency-key';
import { RequirePermission } from '../../../platform/http/route-access';
import { LabOrderReadsService } from '../application/lab-order-reads.service';
import { type CsvFile, LabsService } from '../application/labs.service';

class LabDto extends createZodDto(labSchema) {}
class LabListDto extends createZodDto(z.array(labSchema)) {}
class LabListQueryDto extends createZodDto(labListQuerySchema) {}
class CreateLabDto extends createZodDto(createLabSchema) {}
class UpdateLabDto extends createZodDto(updateLabSchema) {}
class ServiceDto extends createZodDto(labServiceSchema) {}
class CreateServiceDto extends createZodDto(createLabServiceSchema) {}
class UpdateServiceDto extends createZodDto(updateLabServiceSchema) {}
class OpeningBalanceDto extends createZodDto(labOpeningBalanceSchema) {}
class RecordPaymentDto extends createZodDto(recordLabPaymentSchema) {}
class PaymentDto extends createZodDto(labPaymentSchema) {}
class VoidPaymentDto extends createZodDto(voidLabPaymentSchema) {}
class RecordAdjustmentDto extends createZodDto(recordLabAdjustmentSchema) {}
class AdjustmentDto extends createZodDto(labAdjustmentSchema) {}
class AccountsDto extends createZodDto(labAccountsSchema) {}
class StatementQueryDto extends createZodDto(labStatementQuerySchema) {}
class StatementDto extends createZodDto(labStatementSchema) {}
class ReportQueryDto extends createZodDto(labReportQuerySchema) {}
class ReportDto extends createZodDto(labReportSchema) {}
class PatientListQueryDto extends createZodDto(patientListQuerySchema) {}
class PatientPageDto extends createZodDto(patientPageSchema) {}
class IdParamsDto extends createZodDto(z.object({ id: idSchema })) {}
class ServiceParamsDto extends createZodDto(z.object({ id: idSchema, serviceId: idSchema })) {}

export function sendCsv(response: Response, file: CsvFile): void {
  response.status(200);
  response.setHeader('Content-Type', 'text/csv; charset=utf-8');
  response.setHeader('Content-Disposition', `attachment; filename="${file.fileName}"`);
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.send(file.body);
}

/**
 * The labs, their price lists and accounts, the reports and the patients filter (feature 18;
 * docs/modules/labs.md). The directory and reports need `lab:read`, money reads
 * `lab:money_read`, every change here `lab:money_manage`.
 */
@Controller('labs')
export class LabsController {
  constructor(
    private readonly labs: LabsService,
    private readonly reads: LabOrderReadsService,
  ) {}

  @Get()
  @RequirePermission('lab:read')
  @ZodResponse({ type: LabListDto })
  list(@Query() query: LabListQueryDto) {
    return this.labs.list(query);
  }

  @Post()
  @RequirePermission('lab:money_manage')
  @ZodResponse({ status: 201, type: LabDto })
  create(@Body() body: CreateLabDto) {
    return this.labs.create(body);
  }

  @Get('accounts')
  @RequirePermission('lab:money_read')
  @ZodResponse({ type: AccountsDto })
  accounts() {
    return this.labs.accounts();
  }

  @Get('reports')
  @RequirePermission('lab:read')
  @ZodResponse({ type: ReportDto })
  reports(@Query() query: ReportQueryDto) {
    return this.reads.reports(query);
  }

  /** The patients list restricted to open lab work: the same query and page as `GET /patients`. */
  @Get('patients')
  @RequirePermission('lab:read')
  @ZodResponse({ type: PatientPageDto })
  patients(@Query() query: PatientListQueryDto) {
    return this.reads.patientsWithOpenOrders(query);
  }

  @Post('payments/:id/void')
  @HttpCode(200)
  @RequirePermission('lab:money_manage')
  @ZodResponse({ type: PaymentDto })
  voidPayment(@Param() params: IdParamsDto, @Body() body: VoidPaymentDto) {
    return this.labs.voidPayment(params.id, body);
  }

  @Patch(':id')
  @RequirePermission('lab:money_manage')
  @ZodResponse({ type: LabDto })
  update(@Param() params: IdParamsDto, @Body() body: UpdateLabDto) {
    return this.labs.update(params.id, body);
  }

  @Post(':id/services')
  @RequirePermission('lab:money_manage')
  @ZodResponse({ status: 201, type: ServiceDto })
  createService(@Param() params: IdParamsDto, @Body() body: CreateServiceDto) {
    return this.labs.createService(params.id, body);
  }

  @Patch(':id/services/:serviceId')
  @RequirePermission('lab:money_manage')
  @ZodResponse({ type: ServiceDto })
  updateService(@Param() params: ServiceParamsDto, @Body() body: UpdateServiceDto) {
    return this.labs.updateService(params.id, params.serviceId, body);
  }

  @Put(':id/opening-balance')
  @RequirePermission('lab:money_manage')
  @ZodResponse({ type: LabDto })
  openingBalance(@Param() params: IdParamsDto, @Body() body: OpeningBalanceDto) {
    return this.labs.setOpeningBalance(params.id, body);
  }

  @Post(':id/payments')
  @RequirePermission('lab:money_manage')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ZodResponse({ status: 201, type: PaymentDto })
  recordPayment(
    @Param() params: IdParamsDto,
    @Body() body: RecordPaymentDto,
    @Headers('idempotency-key') key: string | undefined,
  ) {
    return this.labs.recordPayment(params.id, body, idempotencyKey(key));
  }

  @Post(':id/adjustments')
  @RequirePermission('lab:money_manage')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ZodResponse({ status: 201, type: AdjustmentDto })
  recordAdjustment(
    @Param() params: IdParamsDto,
    @Body() body: RecordAdjustmentDto,
    @Headers('idempotency-key') key: string | undefined,
  ) {
    return this.labs.recordAdjustment(params.id, body, idempotencyKey(key));
  }

  @Get(':id/statement')
  @RequirePermission('lab:money_read')
  @ZodResponse({ type: StatementDto })
  statement(@Param() params: IdParamsDto, @Query() query: StatementQueryDto) {
    return this.labs.statement(params.id, query);
  }

  @Get(':id/statement/export')
  @RequirePermission('lab:money_read')
  @ApiProduces('text/csv')
  async exportStatement(
    @Param() params: IdParamsDto,
    @Query() query: StatementQueryDto,
    @Res() response: Response,
  ): Promise<void> {
    sendCsv(response, await this.labs.exportStatement(params.id, query));
  }
}
