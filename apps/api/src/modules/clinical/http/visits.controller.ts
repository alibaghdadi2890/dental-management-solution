import {
  idSchema,
  liveVisitQuerySchema,
  liveVisitRefSchema,
  startDefaultsSchema,
  startVisitResultSchema,
  startVisitSchema,
  visitDiscountSchema,
  visitNotesSchema,
  visitResultSchema,
  visitSchema,
} from '@dcm/contracts';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { ApiOkResponse } from '@nestjs/swagger';
import type { Response } from 'express';
import { createZodDto, ZodResponse } from 'nestjs-zod';
import { z } from 'zod';
import { RequirePermission } from '../../../platform/http/route-access';
import { VisitsService } from '../application/visits.service';

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

/**
 * The live visit's lifecycle (docs/modules/clinical.md, spec §HTTP). Every change answers with
 * `{ visit }`, so the client replaces its cache without a refetch. The static paths come before
 * `:id`.
 */
@Controller('visits')
export class VisitsController {
  constructor(private readonly visits: VisitsService) {}

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

  @Get('live')
  @RequirePermission('visit:read')
  @ZodResponse({ type: [LiveVisitRefDto] })
  live(@Query() query: LiveVisitQueryDto) {
    return this.visits.live(query);
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
