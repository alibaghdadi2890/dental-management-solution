import {
  countListQuerySchema,
  countListSchema,
  countSchema,
  createSupplierSchema,
  idSchema,
  recordSupplierAdjustmentSchema,
  recordSupplierPaymentSchema,
  saveCountLineSchema,
  startCountSchema,
  supplierAccountsSchema,
  supplierAdjustmentSchema,
  supplierListQuerySchema,
  supplierOpeningBalanceSchema,
  supplierPaymentSchema,
  supplierSchema,
  supplierStatementQuerySchema,
  supplierStatementSchema,
  updateSupplierSchema,
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
import { CountsService } from '../application/counts.service';
import { SuppliersService } from '../application/suppliers.service';
import { sendCsv } from './inventory.controller';

class CountDto extends createZodDto(countSchema) {}
class CountListDto extends createZodDto(countListSchema) {}
class CountListQueryDto extends createZodDto(countListQuerySchema) {}
class StartCountDto extends createZodDto(startCountSchema) {}
class SaveLineDto extends createZodDto(saveCountLineSchema) {}
class SupplierDto extends createZodDto(supplierSchema) {}
class SupplierListDto extends createZodDto(z.array(supplierSchema)) {}
class SupplierListQueryDto extends createZodDto(supplierListQuerySchema) {}
class CreateSupplierDto extends createZodDto(createSupplierSchema) {}
class UpdateSupplierDto extends createZodDto(updateSupplierSchema) {}
class OpeningBalanceDto extends createZodDto(supplierOpeningBalanceSchema) {}
class RecordPaymentDto extends createZodDto(recordSupplierPaymentSchema) {}
class PaymentDto extends createZodDto(supplierPaymentSchema) {}
class RecordAdjustmentDto extends createZodDto(recordSupplierAdjustmentSchema) {}
class AdjustmentDto extends createZodDto(supplierAdjustmentSchema) {}
class AccountsDto extends createZodDto(supplierAccountsSchema) {}
class StatementQueryDto extends createZodDto(supplierStatementQuerySchema) {}
class StatementDto extends createZodDto(supplierStatementSchema) {}
class IdParamsDto extends createZodDto(z.object({ id: idSchema })) {}
class LineParamsDto extends createZodDto(z.object({ id: idSchema, itemId: idSchema })) {}

/** Stock counts (feature 20a, B5): read with `inventory:read`, kept with `inventory:manage`. */
@Controller('inventory/counts')
export class CountsController {
  constructor(private readonly counts: CountsService) {}

  @Get()
  @RequirePermission('inventory:read')
  @ZodResponse({ type: CountListDto })
  list(@Query() query: CountListQueryDto) {
    return this.counts.list(query.branchId);
  }

  @Post()
  @RequirePermission('inventory:manage')
  @ZodResponse({ status: 201, type: CountDto })
  start(@Body() body: StartCountDto) {
    return this.counts.start(body);
  }

  @Get(':id')
  @RequirePermission('inventory:read')
  @ZodResponse({ type: CountDto })
  get(@Param() params: IdParamsDto) {
    return this.counts.get(params.id);
  }

  @Put(':id/lines/:itemId')
  @RequirePermission('inventory:manage')
  @ZodResponse({ type: CountDto })
  saveLine(@Param() params: LineParamsDto, @Body() body: SaveLineDto) {
    return this.counts.saveLine(params.id, params.itemId, body);
  }

  @Post(':id/apply')
  @HttpCode(200)
  @RequirePermission('inventory:manage')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ZodResponse({ type: CountDto })
  apply(@Param() params: IdParamsDto, @Headers('idempotency-key') key: string | undefined) {
    return this.counts.apply(params.id, idempotencyKey(key));
  }

  @Post(':id/discard')
  @HttpCode(200)
  @RequirePermission('inventory:manage')
  @ZodResponse({ type: CountDto })
  discard(@Param() params: IdParamsDto) {
    return this.counts.discard(params.id);
  }
}

/**
 * Suppliers (feature 20a, Part D): the directory with `inventory:read`, details with
 * `inventory:manage`, accounts with `inventory:money_read`, money with `inventory:money_manage`.
 */
@Controller('inventory/suppliers')
export class SuppliersController {
  constructor(private readonly suppliers: SuppliersService) {}

  @Get()
  @RequirePermission('inventory:read')
  @ZodResponse({ type: SupplierListDto })
  list(@Query() query: SupplierListQueryDto) {
    return this.suppliers.list(query.includeInactive ?? false);
  }

  @Post()
  @RequirePermission('inventory:manage')
  @ZodResponse({ status: 201, type: SupplierDto })
  create(@Body() body: CreateSupplierDto) {
    return this.suppliers.create(body);
  }

  @Get('accounts')
  @RequirePermission('inventory:money_read')
  @ZodResponse({ type: AccountsDto })
  accounts() {
    return this.suppliers.accounts();
  }

  @Get(':id')
  @RequirePermission('inventory:read')
  @ZodResponse({ type: SupplierDto })
  get(@Param() params: IdParamsDto) {
    return this.suppliers.get(params.id);
  }

  @Patch(':id')
  @RequirePermission('inventory:manage')
  @ZodResponse({ type: SupplierDto })
  update(@Param() params: IdParamsDto, @Body() body: UpdateSupplierDto) {
    return this.suppliers.update(params.id, body);
  }

  @Put(':id/opening-balance')
  @RequirePermission('inventory:money_manage')
  @ZodResponse({ type: SupplierDto })
  openingBalance(@Param() params: IdParamsDto, @Body() body: OpeningBalanceDto) {
    return this.suppliers.setOpeningBalance(params.id, body);
  }

  @Post(':id/payments')
  @RequirePermission('inventory:money_manage')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ZodResponse({ status: 201, type: PaymentDto })
  recordPayment(
    @Param() params: IdParamsDto,
    @Body() body: RecordPaymentDto,
    @Headers('idempotency-key') key: string | undefined,
  ) {
    return this.suppliers.recordPayment(params.id, body, idempotencyKey(key));
  }

  @Post(':id/adjustments')
  @RequirePermission('inventory:money_manage')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ZodResponse({ status: 201, type: AdjustmentDto })
  recordAdjustment(
    @Param() params: IdParamsDto,
    @Body() body: RecordAdjustmentDto,
    @Headers('idempotency-key') key: string | undefined,
  ) {
    return this.suppliers.recordAdjustment(params.id, body, idempotencyKey(key));
  }

  @Get(':id/statement')
  @RequirePermission('inventory:money_read')
  @ZodResponse({ type: StatementDto })
  statement(@Param() params: IdParamsDto, @Query() query: StatementQueryDto) {
    return this.suppliers.statement(params.id, query);
  }

  @Get(':id/statement/export')
  @RequirePermission('inventory:money_read')
  @ApiProduces('text/csv')
  async exportStatement(
    @Param() params: IdParamsDto,
    @Query() query: StatementQueryDto,
    @Res() response: Response,
  ): Promise<void> {
    sendCsv(response, await this.suppliers.exportStatement(params.id, query));
  }
}
