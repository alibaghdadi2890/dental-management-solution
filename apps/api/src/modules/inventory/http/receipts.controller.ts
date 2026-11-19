import {
  editReceiptSchema,
  idSchema,
  priceReceiptSchema,
  receiptFileUrlSchema,
  receiptListQuerySchema,
  receiptPageSchema,
  receiptUploadIntentSchema,
  receiptUploadTargetsSchema,
  receiveSchema,
  saveReceiptFilesSchema,
  stockReceiptSchema,
  voidReceiptSchema,
} from '@dcm/contracts';
import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiHeader } from '@nestjs/swagger';
import { createZodDto, ZodResponse } from 'nestjs-zod';
import { z } from 'zod';
import { idempotencyKey } from '../../../platform/http/idempotency-key';
import { RequirePermission } from '../../../platform/http/route-access';
import { ReceiptsService } from '../application/receipts.service';

class ReceiptDto extends createZodDto(stockReceiptSchema) {}
class ReceiveDto extends createZodDto(receiveSchema) {}
class ReceiptQueryDto extends createZodDto(receiptListQuerySchema) {}
class ReceiptPageDto extends createZodDto(receiptPageSchema) {}
class PriceDto extends createZodDto(priceReceiptSchema) {}
class EditDto extends createZodDto(editReceiptSchema) {}
class VoidDto extends createZodDto(voidReceiptSchema) {}
class UploadIntentDto extends createZodDto(receiptUploadIntentSchema) {}
class UploadTargetsDto extends createZodDto(receiptUploadTargetsSchema) {}
class SaveFilesDto extends createZodDto(saveReceiptFilesSchema) {}
class FileUrlDto extends createZodDto(receiptFileUrlSchema) {}
class IdParamsDto extends createZodDto(z.object({ id: idSchema })) {}
class FileParamsDto extends createZodDto(z.object({ id: idSchema, fileId: idSchema })) {}

/**
 * Deliveries received (feature 20a, B1). Receiving and attaching need `inventory:write`; prices
 * and a one-off purchase `inventory:money_manage` (checked by the service on what is sent);
 * editing and voiding `inventory:manage`; opening an attachment `inventory:money_read`.
 */
@Controller('inventory/receipts')
export class ReceiptsController {
  constructor(private readonly receipts: ReceiptsService) {}

  @Get()
  @RequirePermission('inventory:read')
  @ZodResponse({ type: ReceiptPageDto })
  list(@Query() query: ReceiptQueryDto) {
    return this.receipts.list(query);
  }

  @Post()
  @RequirePermission('inventory:write')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ZodResponse({ status: 201, type: ReceiptDto })
  receive(@Body() body: ReceiveDto, @Headers('idempotency-key') key: string | undefined) {
    return this.receipts.receive(body, idempotencyKey(key));
  }

  @Get(':id')
  @RequirePermission('inventory:read')
  @ZodResponse({ type: ReceiptDto })
  get(@Param() params: IdParamsDto) {
    return this.receipts.get(params.id);
  }

  @Put(':id/prices')
  @RequirePermission('inventory:money_manage')
  @ZodResponse({ type: ReceiptDto })
  price(@Param() params: IdParamsDto, @Body() body: PriceDto) {
    return this.receipts.price(params.id, body);
  }

  @Patch(':id')
  @RequirePermission('inventory:manage')
  @ZodResponse({ type: ReceiptDto })
  edit(@Param() params: IdParamsDto, @Body() body: EditDto) {
    return this.receipts.edit(params.id, body);
  }

  @Post(':id/void')
  @HttpCode(200)
  @RequirePermission('inventory:manage')
  @ZodResponse({ type: ReceiptDto })
  void(@Param() params: IdParamsDto, @Body() body: VoidDto) {
    return this.receipts.void(params.id, body.reason);
  }

  @Post(':id/files/uploads')
  @RequirePermission('inventory:write')
  @ZodResponse({ status: 201, type: UploadTargetsDto })
  requestUploads(@Param() params: IdParamsDto, @Body() body: UploadIntentDto) {
    return this.receipts.requestUploads(params.id, body);
  }

  @Post(':id/files')
  @HttpCode(200)
  @RequirePermission('inventory:write')
  @ZodResponse({ type: ReceiptDto })
  saveFiles(@Param() params: IdParamsDto, @Body() body: SaveFilesDto) {
    return this.receipts.saveFiles(params.id, body.ids);
  }

  @Get(':id/files/:fileId')
  @RequirePermission('inventory:money_read')
  @ZodResponse({ type: FileUrlDto })
  fileUrl(@Param() params: FileParamsDto) {
    return this.receipts.fileUrl(params.id, params.fileId);
  }

  @Delete(':id/files/:fileId')
  @RequirePermission('inventory:money_manage')
  @ZodResponse({ type: ReceiptDto })
  removeFile(@Param() params: FileParamsDto) {
    return this.receipts.removeFile(params.id, params.fileId);
  }
}
