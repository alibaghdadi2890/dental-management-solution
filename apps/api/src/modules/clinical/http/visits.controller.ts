import {
  amendVisitSchema,
  checkoutDiscountSchema,
  idSchema,
  liveVisitQuerySchema,
  liveVisitRefSchema,
  startDefaultsSchema,
  startOptionsQuerySchema,
  startOptionsSchema,
  startVisitResultSchema,
  startVisitSchema,
  visitComplaintInputSchema,
  visitDiscountSchema,
  visitFiltersSchema,
  visitListQuerySchema,
  visitListSummarySchema,
  visitNotesSchema,
  visitPageSchema,
  visitReasonInputSchema,
  visitResultSchema,
  visitSchema,
  visitStepInputSchema,
  visitViewInputSchema,
  voidVisitSchema,
  visitNumberSchema,
  visitNumbersQuerySchema,
} from '@dcm/contracts';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Res,
} from '@nestjs/common';
import { ApiOkResponse } from '@nestjs/swagger';
import type { Response } from 'express';
import { createZodDto, ZodResponse } from 'nestjs-zod';
import { z } from 'zod';
import { RequirePermission } from '../../../platform/http/route-access';
import { StartOptionsService } from '../application/reads/start-options.service';
import { VisitListService } from '../application/reads/visit-list.service';
import { VisitCorrectionsService } from '../application/visits/visit-corrections.service';
import { VisitFactsService } from '../application/visits/visit-facts.service';
import { VisitFlowService } from '../application/visits/visit-flow.service';
import { VisitsService } from '../application/visits/visits.service';

class StartVisitDto extends createZodDto(startVisitSchema) {}
class StartVisitResultDto extends createZodDto(startVisitResultSchema) {}
class StartDefaultsDto extends createZodDto(startDefaultsSchema) {}
class LiveVisitQueryDto extends createZodDto(liveVisitQuerySchema) {}
class LiveVisitRefDto extends createZodDto(liveVisitRefSchema) {}
class VisitDto extends createZodDto(visitSchema) {}
class VisitResultDto extends createZodDto(visitResultSchema) {}
class VisitNotesDto extends createZodDto(visitNotesSchema) {}
class VisitDiscountDto extends createZodDto(visitDiscountSchema) {}
class VisitParamsDto extends createZodDto(z.object({ id: idSchema })) {}
class AmendVisitDto extends createZodDto(amendVisitSchema) {}
class CheckoutDiscountDto extends createZodDto(checkoutDiscountSchema) {}
class VisitListQueryDto extends createZodDto(visitListQuerySchema) {}
class VisitPageDto extends createZodDto(visitPageSchema) {}
class VisitFiltersDto extends createZodDto(visitFiltersSchema) {}
class VisitListSummaryDto extends createZodDto(visitListSummarySchema) {}
class VisitNumbersQueryDto extends createZodDto(visitNumbersQuerySchema) {}
class VisitNumberDto extends createZodDto(visitNumberSchema) {}
class VoidVisitDto extends createZodDto(voidVisitSchema) {}
class StartOptionsQueryDto extends createZodDto(startOptionsQuerySchema) {}
class StartOptionsDto extends createZodDto(startOptionsSchema) {}
class VisitStepDto extends createZodDto(visitStepInputSchema) {}
class VisitViewDto extends createZodDto(visitViewInputSchema) {}
class VisitReasonDto extends createZodDto(visitReasonInputSchema) {}
class VisitComplaintDto extends createZodDto(visitComplaintInputSchema) {}
class WorklistParamsDto extends createZodDto(z.object({ id: idSchema, planId: idSchema })) {}

/**
 * The live visit's lifecycle (docs/modules/clinical.md, spec §HTTP). Every change answers with
 * `{ visit }`, so the client replaces its cache without a refetch. The static paths come before
 * `:id`.
 */
@Controller('visits')
export class VisitsController {
  constructor(
    private readonly visits: VisitsService,
    private readonly corrections: VisitCorrectionsService,
    private readonly list: VisitListService,
    private readonly facts: VisitFactsService,
    private readonly flow: VisitFlowService,
    private readonly startOptionsFor: StartOptionsService,
  ) {}

  /** 201 for a new visit; 200 with `resumed: true` when the patient already had a live one. */
  @Post()
  @RequirePermission('visit:write')
  @ZodResponse({ status: 201, description: 'A new visit', type: StartVisitResultDto })
  @ApiOkResponse({
    description: "The patient's live visit, resumed",
    type: StartVisitResultDto.Output,
  })
  async start(@Body() body: StartVisitDto, @Res({ passthrough: true }) response: Response) {
    const result = await this.visits.start(body);
    if (result.resumed) response.status(HttpStatus.OK);
    return result;
  }

  @Get('start-defaults')
  @RequirePermission('visit:write')
  @ZodResponse({ type: StartDefaultsDto })
  startDefaults() {
    return this.visits.startDefaults();
  }

  /** What the Start visit popover offers for a patient: the suggested type and the open plans. */
  @Get('start-options')
  @RequirePermission('visit:write')
  @ZodResponse({ type: StartOptionsDto })
  startOptions(@Query() query: StartOptionsQueryDto) {
    return this.startOptionsFor.forPatient(query.patientId);
  }

  @Get('live')
  @RequirePermission('visit:read')
  @ZodResponse({ type: [LiveVisitRefDto] })
  live(@Query() query: LiveVisitQueryDto) {
    return this.visits.live(query);
  }

  /** The visits list (4b): cursor-paged, newest first; the Unpaid tab is `billing`'s. */
  @Get()
  @RequirePermission('visit:read')
  @ZodResponse({ type: VisitPageDto })
  search(@Query() query: VisitListQueryDto) {
    return this.list.search(query);
  }

  @Get('summary')
  @RequirePermission('visit:read')
  @ZodResponse({ type: VisitListSummaryDto })
  summary(@Query() query: VisitFiltersDto) {
    return this.list.summary(query);
  }

  /** Before `:id`, like the other static paths. */
  @Get('numbers')
  @RequirePermission('visit:read')
  @ZodResponse({ type: [VisitNumberDto] })
  numbers(@Query() query: VisitNumbersQueryDto) {
    return this.facts.numbersFor(query.ids);
  }

  @Get(':id')
  @RequirePermission('visit:read')
  @ZodResponse({ type: VisitDto })
  get(@Param() params: VisitParamsDto) {
    return this.visits.get(params.id);
  }

  @Post(':id/pause')
  @RequirePermission('visit:write')
  @HttpCode(HttpStatus.OK)
  @ZodResponse({ type: VisitResultDto })
  pause(@Param() params: VisitParamsDto) {
    return this.visits.pause(params.id);
  }

  @Post(':id/resume')
  @RequirePermission('visit:write')
  @HttpCode(HttpStatus.OK)
  @ZodResponse({ type: VisitResultDto })
  resume(@Param() params: VisitParamsDto) {
    return this.visits.resume(params.id);
  }

  @Post(':id/discard')
  @RequirePermission('visit:write')
  @HttpCode(HttpStatus.OK)
  @ZodResponse({ type: VisitResultDto })
  discard(@Param() params: VisitParamsDto) {
    return this.visits.discard(params.id);
  }

  /** `{ visit }` with the completed visit; `billing` has posted its charge in the same transaction. */
  @Post(':id/complete')
  @RequirePermission('visit:write')
  @HttpCode(HttpStatus.OK)
  @ZodResponse({ type: VisitResultDto })
  complete(@Param() params: VisitParamsDto) {
    return this.visits.complete(params.id);
  }

  /** `{ visit }` amended; `billing` has posted the difference in the same transaction (4b). */
  @Post(':id/amend')
  @RequirePermission('visit:amend')
  @HttpCode(HttpStatus.OK)
  @ZodResponse({ type: VisitResultDto })
  amend(@Param() params: VisitParamsDto, @Body() body: AmendVisitDto) {
    return this.corrections.amend(params.id, body);
  }

  /** `{ visit }` with the discount set at checkout; `billing` has posted the difference. */
  @Post(':id/checkout-discount')
  @RequirePermission('visit:discount')
  @HttpCode(HttpStatus.OK)
  @ZodResponse({ type: VisitResultDto })
  checkoutDiscount(@Param() params: VisitParamsDto, @Body() body: CheckoutDiscountDto) {
    return this.corrections.setCheckoutDiscount(params.id, body);
  }

  /** `{ visit }` out of the checkout queue: its checkout was closed without a payment (ADR-0033). */
  @Post(':id/checkout')
  @RequirePermission('payment:write')
  @HttpCode(HttpStatus.OK)
  @ZodResponse({ type: VisitResultDto })
  checkOut(@Param() params: VisitParamsDto) {
    return this.corrections.checkOut(params.id);
  }

  /** `{ visit }` voided; `billing` has reversed its charge in the same transaction (4b). */
  @Post(':id/void')
  @RequirePermission('visit:void')
  @HttpCode(HttpStatus.OK)
  @ZodResponse({ type: VisitResultDto })
  void(@Param() params: VisitParamsDto, @Body() body: VoidVisitDto) {
    return this.corrections.void(params.id, body);
  }

  // --- The flow (feature 10): where the visit is, and what it was told at the start of it ---

  @Patch(':id/step')
  @RequirePermission('visit:write')
  @ZodResponse({ type: VisitResultDto })
  setStep(@Param() params: VisitParamsDto, @Body() body: VisitStepDto) {
    return this.flow.setStep(params.id, body);
  }

  @Patch(':id/view')
  @RequirePermission('visit:write')
  @ZodResponse({ type: VisitResultDto })
  setView(@Param() params: VisitParamsDto, @Body() body: VisitViewDto) {
    return this.flow.setView(params.id, body);
  }

  @Patch(':id/reason')
  @RequirePermission('visit:write')
  @ZodResponse({ type: VisitResultDto })
  setReason(@Param() params: VisitParamsDto, @Body() body: VisitReasonDto) {
    return this.flow.setReason(params.id, body);
  }

  @Patch(':id/complaint')
  @RequirePermission('visit:write')
  @ZodResponse({ type: VisitResultDto })
  setComplaint(@Param() params: VisitParamsDto, @Body() body: VisitComplaintDto) {
    return this.flow.setComplaint(params.id, body);
  }

  /** "Confirmed with the patient": a dentist's (or the owner's) to give, and to take back. */
  @Put(':id/history-confirmation')
  @RequirePermission('chart:write')
  @ZodResponse({ type: VisitResultDto })
  confirmHistory(@Param() params: VisitParamsDto) {
    return this.flow.confirmHistory(params.id);
  }

  @Delete(':id/history-confirmation')
  @RequirePermission('chart:write')
  @ZodResponse({ type: VisitResultDto })
  unconfirmHistory(@Param() params: VisitParamsDto) {
    return this.flow.unconfirmHistory(params.id);
  }

  /** Today's work: a planned treatment ticked onto the visit's list, or off it. */
  @Put(':id/worklist/:planId')
  @RequirePermission('visit:write')
  @ZodResponse({ type: VisitResultDto })
  addWorkItem(@Param() params: WorklistParamsDto) {
    return this.flow.setWorkItem(params.id, params.planId, true);
  }

  @Delete(':id/worklist/:planId')
  @RequirePermission('visit:write')
  @ZodResponse({ type: VisitResultDto })
  removeWorkItem(@Param() params: WorklistParamsDto) {
    return this.flow.setWorkItem(params.id, params.planId, false);
  }

  @Patch(':id/notes')
  @RequirePermission('visit:write')
  @ZodResponse({ type: VisitResultDto })
  updateNotes(@Param() params: VisitParamsDto, @Body() body: VisitNotesDto) {
    return this.visits.updateNotes(params.id, body);
  }

  @Patch(':id/discount')
  @RequirePermission('visit:write')
  @ZodResponse({ type: VisitResultDto })
  setDiscount(@Param() params: VisitParamsDto, @Body() body: VisitDiscountDto) {
    return this.visits.setDiscount(params.id, body);
  }
}
