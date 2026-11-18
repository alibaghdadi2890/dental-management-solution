import {
  cancelLabOrderSchema,
  correctLabTripSchema,
  createLabOrderSchema,
  expectedLabOrderSchema,
  holdLabOrderSchema,
  idSchema,
  labOpenOrdersSchema,
  labOrderAttachmentsSchema,
  labOrderExportQuerySchema,
  labOrderListQuerySchema,
  labOrderPageSchema,
  labOrderSchema,
  labOutcomeSchema,
  labProposalQuerySchema,
  labProposalSchema,
  labTodayQuerySchema,
  labTodaySchema,
  linkLabOrderSchema,
  receiveLabOrdersSchema,
  sendLabOrderSchema,
  undoLabOrderSchema,
  updateLabOrderSchema,
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
import { LabOrdersService } from '../application/lab-orders.service';
import { sendCsv } from './labs.controller';

class OrderDto extends createZodDto(labOrderSchema) {}
class OrderListDto extends createZodDto(z.array(labOrderSchema)) {}
class OrderPageDto extends createZodDto(labOrderPageSchema) {}
class OpenOrdersDto extends createZodDto(labOpenOrdersSchema) {}
class ListQueryDto extends createZodDto(labOrderListQuerySchema) {}
class ExportQueryDto extends createZodDto(labOrderExportQuerySchema) {}
class TodayQueryDto extends createZodDto(labTodayQuerySchema) {}
class TodayDto extends createZodDto(labTodaySchema) {}
class ProposalQueryDto extends createZodDto(labProposalQuerySchema) {}
class ProposalDto extends createZodDto(labProposalSchema) {}
class CreateOrderDto extends createZodDto(createLabOrderSchema) {}
class UpdateOrderDto extends createZodDto(updateLabOrderSchema) {}
class SendDto extends createZodDto(sendLabOrderSchema) {}
class ReceiveDto extends createZodDto(receiveLabOrdersSchema) {}
class ExpectedDto extends createZodDto(expectedLabOrderSchema) {}
class OutcomeDto extends createZodDto(labOutcomeSchema) {}
class HoldDto extends createZodDto(holdLabOrderSchema) {}
class CancelDto extends createZodDto(cancelLabOrderSchema) {}
class UndoDto extends createZodDto(undoLabOrderSchema) {}
class LinkDto extends createZodDto(linkLabOrderSchema) {}
class AttachmentsDto extends createZodDto(labOrderAttachmentsSchema) {}
class CorrectTripDto extends createZodDto(correctLabTripSchema) {}
class IdParamsDto extends createZodDto(z.object({ id: idSchema })) {}
class TripParamsDto extends createZodDto(
  z.object({ id: idSchema, seq: z.coerce.number().int().min(1).max(99) }),
) {}

/**
 * Lab orders (feature 18, Parts B and C; docs/modules/labs.md): reads need `lab:read`, every
 * change `lab:manage` (a cost or a charge also `lab:money_manage`, checked in the service).
 */
@Controller('lab-orders')
export class LabOrdersController {
  constructor(
    private readonly orders: LabOrdersService,
    private readonly reads: LabOrderReadsService,
  ) {}

  @Get()
  @RequirePermission('lab:read')
  @ZodResponse({ type: OrderPageDto })
  list(@Query() query: ListQueryDto) {
    return this.reads.list(query);
  }

  @Get('export')
  @RequirePermission('lab:read')
  @ApiProduces('text/csv')
  async export(@Query() query: ExportQueryDto, @Res() response: Response): Promise<void> {
    sendCsv(response, await this.reads.export(query));
  }

  @Get('open')
  @RequirePermission('lab:read')
  @ZodResponse({ type: OpenOrdersDto })
  open() {
    return this.reads.open();
  }

  @Get('today')
  @RequirePermission('lab:read')
  @ZodResponse({ type: TodayDto })
  today(@Query() query: TodayQueryDto) {
    return this.reads.today(query.branchId);
  }

  @Get('proposal')
  @RequirePermission('lab:read')
  @ZodResponse({ type: ProposalDto })
  proposal(@Query() query: ProposalQueryDto) {
    return this.reads.proposal(query.patientId, query.dentistId);
  }

  @Post()
  @RequirePermission('lab:manage')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ZodResponse({ status: 201, type: OrderDto })
  create(@Body() body: CreateOrderDto, @Headers('idempotency-key') key: string | undefined) {
    return this.orders.create(body, idempotencyKey(key));
  }

  @Post('receive')
  @HttpCode(200)
  @RequirePermission('lab:manage')
  @ZodResponse({ type: OrderListDto })
  receive(@Body() body: ReceiveDto) {
    return this.orders.receive(body);
  }

  @Get(':id')
  @RequirePermission('lab:read')
  @ZodResponse({ type: OrderDto })
  get(@Param() params: IdParamsDto) {
    return this.reads.get(params.id);
  }

  @Patch(':id')
  @RequirePermission('lab:manage')
  @ZodResponse({ type: OrderDto })
  update(@Param() params: IdParamsDto, @Body() body: UpdateOrderDto) {
    return this.orders.update(params.id, body);
  }

  @Post(':id/send')
  @HttpCode(200)
  @RequirePermission('lab:manage')
  @ZodResponse({ type: OrderDto })
  send(@Param() params: IdParamsDto, @Body() body: SendDto) {
    return this.orders.send(params.id, body);
  }

  @Post(':id/expected')
  @HttpCode(200)
  @RequirePermission('lab:manage')
  @ZodResponse({ type: OrderDto })
  expected(@Param() params: IdParamsDto, @Body() body: ExpectedDto) {
    return this.orders.expected(params.id, body);
  }

  @Post(':id/outcome')
  @HttpCode(200)
  @RequirePermission('lab:manage')
  @ZodResponse({ type: OrderDto })
  outcome(@Param() params: IdParamsDto, @Body() body: OutcomeDto) {
    return this.orders.outcome(params.id, body);
  }

  @Post(':id/hold')
  @HttpCode(200)
  @RequirePermission('lab:manage')
  @ZodResponse({ type: OrderDto })
  hold(@Param() params: IdParamsDto, @Body() body: HoldDto) {
    return this.orders.hold(params.id, body);
  }

  @Post(':id/resume')
  @HttpCode(200)
  @RequirePermission('lab:manage')
  @ZodResponse({ type: OrderDto })
  resume(@Param() params: IdParamsDto) {
    return this.orders.resume(params.id);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @RequirePermission('lab:manage')
  @ZodResponse({ type: OrderDto })
  cancel(@Param() params: IdParamsDto, @Body() body: CancelDto) {
    return this.orders.cancel(params.id, body);
  }

  @Post(':id/undo')
  @HttpCode(200)
  @RequirePermission('lab:manage')
  @ZodResponse({ type: OrderDto })
  undo(@Param() params: IdParamsDto, @Body() body: UndoDto) {
    return this.orders.undo(params.id, body);
  }

  @Post(':id/link')
  @HttpCode(200)
  @RequirePermission('lab:manage')
  @ZodResponse({ type: OrderDto })
  link(@Param() params: IdParamsDto, @Body() body: LinkDto) {
    return this.orders.link(params.id, body);
  }

  @Post(':id/attachments')
  @HttpCode(200)
  @RequirePermission('lab:manage')
  @ZodResponse({ type: OrderDto })
  attachments(@Param() params: IdParamsDto, @Body() body: AttachmentsDto) {
    return this.orders.attachments(params.id, body);
  }

  @Patch(':id/trips/:seq')
  @RequirePermission('lab:manage')
  @ZodResponse({ type: OrderDto })
  correctTrip(@Param() params: TripParamsDto, @Body() body: CorrectTripDto) {
    return this.orders.correctTrip(params.id, params.seq, body);
  }
}
