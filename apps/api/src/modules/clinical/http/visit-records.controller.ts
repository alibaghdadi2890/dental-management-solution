import {
  addServiceSchema,
  answerUnfinishedSchema,
  diagnosisResultSchema,
  idSchema,
  planResultSchema,
  planTreatmentSchema,
  recordDiagnosisSchema,
  recordSessionSchema,
  serviceResultSchema,
  setToothPresenceSchema,
  successionPositionSchema,
  toothPresenceResultSchema,
  updateServiceSchema,
  visitResultSchema,
} from '@dcm/contracts';
import {
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
} from '@nestjs/common';
import { createZodDto, ZodResponse } from 'nestjs-zod';
import { z } from 'zod';
import { RequirePermission } from '../../../platform/http/route-access';
import { VisitRecordsService } from '../application/visit-records.service';

class AddServiceDto extends createZodDto(addServiceSchema) {}
class UpdateServiceDto extends createZodDto(updateServiceSchema) {}
class RecordDiagnosisDto extends createZodDto(recordDiagnosisSchema) {}
class PlanTreatmentDto extends createZodDto(planTreatmentSchema) {}
class AnswerUnfinishedDto extends createZodDto(answerUnfinishedSchema) {}
class VisitResultDto extends createZodDto(visitResultSchema) {}
class RecordSessionDto extends createZodDto(recordSessionSchema) {}
class SetToothPresenceDto extends createZodDto(setToothPresenceSchema) {}
class ServiceResultDto extends createZodDto(serviceResultSchema) {}
class DiagnosisResultDto extends createZodDto(diagnosisResultSchema) {}
class PlanResultDto extends createZodDto(planResultSchema) {}
class ToothPresenceResultDto extends createZodDto(toothPresenceResultSchema) {}
class VisitParamsDto extends createZodDto(z.object({ id: idSchema })) {}
class ServiceParamsDto extends createZodDto(z.object({ id: idSchema, serviceId: idSchema })) {}
class DiagnosisParamsDto extends createZodDto(z.object({ id: idSchema, recordId: idSchema })) {}
class PlanParamsDto extends createZodDto(z.object({ id: idSchema, planId: idSchema })) {}
/** A position that is not a succession position (a permanent code at position 1–5) → 400. */
class ToothParamsDto extends createZodDto(
  z.object({ id: idSchema, position: successionPositionSchema }),
) {}

/**
 * Charting inside a live visit (docs/modules/clinical.md, spec §HTTP). Every route answers with
 * `{ visit, record }`: the updated visit (services and money), so the client replaces its cache
 * without a refetch, and the record the call created or changed (a removed one included).
 */
@Controller('visits')
export class VisitRecordsController {
  constructor(private readonly records: VisitRecordsService) {}

  // --- Services ---

  @Post(':id/services')
  @RequirePermission('visit:write')
  @ZodResponse({ status: 201, type: ServiceResultDto })
  addService(@Param() params: VisitParamsDto, @Body() body: AddServiceDto) {
    return this.records.addService(params.id, body);
  }

  @Patch(':id/services/:serviceId')
  @RequirePermission('visit:write')
  @ZodResponse({ type: ServiceResultDto })
  updateService(@Param() params: ServiceParamsDto, @Body() body: UpdateServiceDto) {
    return this.records.updateService(params.id, params.serviceId, body);
  }

  @Delete(':id/services/:serviceId')
  @RequirePermission('visit:write')
  @ZodResponse({ type: ServiceResultDto })
  removeService(@Param() params: ServiceParamsDto) {
    return this.records.removeService(params.id, params.serviceId);
  }

  /** Not finished: the service becomes work in progress; the answer's record is its plan. */
  @Post(':id/services/:serviceId/unfinished')
  @RequirePermission('visit:write')
  @HttpCode(HttpStatus.OK)
  @ZodResponse({ type: PlanResultDto })
  markServiceUnfinished(@Param() params: ServiceParamsDto) {
    return this.records.markServiceUnfinished(params.id, params.serviceId);
  }

  /** Which unfinished services this visit continues; none is "Not today". */
  @Post(':id/unfinished-answer')
  @RequirePermission('visit:write')
  @HttpCode(HttpStatus.OK)
  @ZodResponse({ type: VisitResultDto })
  answerUnfinished(@Param() params: VisitParamsDto, @Body() body: AnswerUnfinishedDto) {
    return this.records.answerUnfinished(params.id, body);
  }

  // --- Diagnoses ---

  @Post(':id/diagnoses')
  @RequirePermission('visit:write')
  @ZodResponse({ status: 201, type: DiagnosisResultDto })
  recordDiagnosis(@Param() params: VisitParamsDto, @Body() body: RecordDiagnosisDto) {
    return this.records.recordDiagnosis(params.id, body);
  }

  @Post(':id/diagnoses/:recordId/resolve')
  @RequirePermission('visit:write')
  @HttpCode(HttpStatus.OK)
  @ZodResponse({ type: DiagnosisResultDto })
  resolveDiagnosis(@Param() params: DiagnosisParamsDto) {
    return this.records.resolveDiagnosis(params.id, params.recordId);
  }

  @Post(':id/diagnoses/:recordId/reopen')
  @RequirePermission('visit:write')
  @HttpCode(HttpStatus.OK)
  @ZodResponse({ type: DiagnosisResultDto })
  reopenDiagnosis(@Param() params: DiagnosisParamsDto) {
    return this.records.reopenDiagnosis(params.id, params.recordId);
  }

  @Delete(':id/diagnoses/:recordId')
  @RequirePermission('visit:write')
  @ZodResponse({ type: DiagnosisResultDto })
  removeDiagnosis(@Param() params: DiagnosisParamsDto) {
    return this.records.removeDiagnosis(params.id, params.recordId);
  }

  // --- Plans ---

  @Post(':id/plans')
  @RequirePermission('visit:write')
  @ZodResponse({ status: 201, type: PlanResultDto })
  planTreatment(@Param() params: VisitParamsDto, @Body() body: PlanTreatmentDto) {
    return this.records.planTreatment(params.id, body);
  }

  /** The plan as performed; the service it became is in `visit.services`. */
  @Post(':id/plans/:planId/perform')
  @RequirePermission('visit:write')
  @HttpCode(HttpStatus.OK)
  @ZodResponse({ type: PlanResultDto })
  performPlan(@Param() params: PlanParamsDto) {
    return this.records.performPlan(params.id, params.planId);
  }

  /** Continue today: this visit's session on a plan in progress. */
  @Put(':id/plans/:planId/session')
  @RequirePermission('visit:write')
  @ZodResponse({ type: PlanResultDto })
  recordSession(@Param() params: PlanParamsDto, @Body() body: RecordSessionDto) {
    return this.records.recordSession(params.id, params.planId, body);
  }

  /** Not today: the Undo of Continue, or of Not finished in the visit that first worked on it. */
  @Delete(':id/plans/:planId/session')
  @RequirePermission('visit:write')
  @ZodResponse({ type: PlanResultDto })
  removeSession(@Param() params: PlanParamsDto) {
    return this.records.removeSession(params.id, params.planId);
  }

  @Post(':id/plans/:planId/cancel')
  @RequirePermission('visit:write')
  @HttpCode(HttpStatus.OK)
  @ZodResponse({ type: PlanResultDto })
  cancelPlan(@Param() params: PlanParamsDto) {
    return this.records.cancelPlan(params.id, params.planId);
  }

  @Delete(':id/plans/:planId')
  @RequirePermission('visit:write')
  @ZodResponse({ type: PlanResultDto })
  removePlan(@Param() params: PlanParamsDto) {
    return this.records.removePlan(params.id, params.planId);
  }

  // --- Tooth presence ---

  @Put(':id/teeth/:position')
  @RequirePermission('visit:write')
  @ZodResponse({ type: ToothPresenceResultDto })
  setToothPresence(@Param() params: ToothParamsDto, @Body() body: SetToothPresenceDto) {
    return this.records.setToothPresence(params.id, params.position, body);
  }
}
