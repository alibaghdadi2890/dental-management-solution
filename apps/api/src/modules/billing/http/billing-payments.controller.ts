import {
  idSchema,
  paymentInputSchema,
  receiptSchema,
  transactionExportQuerySchema,
  transactionPageSchema,
  transactionQuerySchema,
  paymentPreviewSchema,
  paymentWriteResultSchema,
  recordPaymentResultSchema,
  refundInputSchema,
  voidPaymentInputSchema,
} from '@dcm/contracts';
import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Logger,
  Param,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { ApiHeader, ApiProduces } from '@nestjs/swagger';
import type { Response } from 'express';
import { createZodDto, ZodResponse } from 'nestjs-zod';
import { z } from 'zod';
import { idempotencyKey } from '../../../platform/http/idempotency-key';
import { RequirePermission } from '../../../platform/http/route-access';
import { PaymentViewsService } from '../application/payment-views.service';
import { PaymentsService } from '../application/payments.service';
import { exportLocale } from './export-headers';
import { streamChunks } from './stream-chunks';
import { transactionExportLabels } from './transaction-export-headers';

class PaymentInputDto extends createZodDto(paymentInputSchema) {}
class PaymentPreviewDto extends createZodDto(paymentPreviewSchema) {}
class RecordPaymentResultDto extends createZodDto(recordPaymentResultSchema) {}
class RefundInputDto extends createZodDto(refundInputSchema) {}
class VoidPaymentInputDto extends createZodDto(voidPaymentInputSchema) {}
class PaymentWriteResultDto extends createZodDto(paymentWriteResultSchema) {}
class PaymentParamsDto extends createZodDto(z.object({ id: idSchema })) {}
class TransactionQueryDto extends createZodDto(transactionQuerySchema) {}
class TransactionPageDto extends createZodDto(transactionPageSchema) {}
class TransactionExportQueryDto extends createZodDto(transactionExportQuerySchema) {}
class ReceiptDto extends createZodDto(receiptSchema) {}

/** A download idle this long (no socket activity) is dropped. */
const EXPORT_IDLE_TIMEOUT_MS = 60_000;

/**
 * Payments (feature 5, docs/modules/billing.md): the Transactions list and export, receipts,
 * and recording, previewing, refunding and voiding.
 */
@Controller('billing/payments')
export class BillingPaymentsController {
  private readonly logger = new Logger(BillingPaymentsController.name);

  constructor(
    private readonly payments: PaymentsService,
    private readonly views: PaymentViewsService,
  ) {}

  @Get()
  @RequirePermission('payment:read')
  @ZodResponse({ type: TransactionPageDto })
  transactions(@Query() query: TransactionQueryDto) {
    return this.views.transactions(query);
  }

  /** `text/csv`, streamed like the visits export; `lang`, else `Accept-Language`. */
  @Get('export')
  @RequirePermission('payment:read')
  @ApiProduces('text/csv')
  async export(
    @Query() query: TransactionExportQueryDto,
    @Headers('accept-language') acceptLanguage: string | undefined,
    @Res() response: Response,
  ): Promise<void> {
    const labels = transactionExportLabels(query.lang ?? exportLocale(acceptLanguage));
    const { fileName, chunks } = await this.views.exportTransactions(query, labels);
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
      this.logger.error({ err: error }, 'the payments export failed after the download started');
      response.destroy();
    }
  }

  @Get(':id/receipt')
  @RequirePermission('payment:read')
  @ZodResponse({ type: ReceiptDto })
  receipt(@Param() params: PaymentParamsDto) {
    return this.views.receipt(params.id);
  }

  @Post()
  @RequirePermission('payment:write')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ZodResponse({ status: 201, type: RecordPaymentResultDto })
  record(@Body() body: PaymentInputDto, @Headers('idempotency-key') key: string | undefined) {
    return this.payments.record(body, idempotencyKey(key));
  }

  @Post('preview')
  @HttpCode(200)
  @RequirePermission('payment:write')
  @ZodResponse({ status: 200, type: PaymentPreviewDto })
  preview(@Body() body: PaymentInputDto) {
    return this.payments.preview(body);
  }

  @Post(':id/refund')
  @RequirePermission('payment:refund')
  @ZodResponse({ status: 201, type: PaymentWriteResultDto })
  refund(@Param() params: PaymentParamsDto, @Body() body: RefundInputDto) {
    return this.payments.refund(params.id, body);
  }

  @Post(':id/void')
  @RequirePermission('payment:refund')
  @ZodResponse({ status: 201, type: PaymentWriteResultDto })
  void(@Param() params: PaymentParamsDto, @Body() body: VoidPaymentInputDto) {
    return this.payments.void(params.id, body);
  }
}
