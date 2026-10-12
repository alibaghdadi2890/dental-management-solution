import {
  addServiceSchema,
  diagnosisResultSchema,
  idSchema,
  planPriorityInputSchema,
  planResultSchema,
  planTreatmentSchema,
  presenceResultSchema,
  recordDiagnosisSchema,
  recordSessionSchema,
  seenOnInputSchema,
  serviceResultSchema,
  setPresenceInVisitSchema,
  toothCodeSchema,
  updateServiceSchema,
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
import { PlanChartingService } from '../application/plan/plan-charting.service';
import { DiagnosisChartingService } from '../application/records/diagnosis-charting.service';
import { PresenceChartingService } from '../application/records/presence-charting.service';
import { ServiceChartingService } from '../application/records/service-charting.service';

class AddServiceDto extends createZodDto(addServiceSchema) {}
class UpdateServiceDto extends createZodDto(updateServiceSchema) {}
class RecordDiagnosisDto extends createZodDto(recordDiagnosisSchema) {}
class PlanTreatmentDto extends createZodDto(planTreatmentSchema) {}
class RecordSessionDto extends createZodDto(recordSessionSchema) {}
class SeenOnDto extends createZodDto(seenOnInputSchema) {}
class PlanPriorityDto extends createZodDto(planPriorityInputSchema) {}
class SetPresenceDto extends createZodDto(setPresenceInVisitSchema) {}
class ServiceResultDto extends createZodDto(serviceResultSchema) {}
class DiagnosisResultDto extends createZodDto(diagnosisResultSchema) {}
class PlanResultDto extends createZodDto(planResultSchema) {}
class PresenceResultDto extends createZodDto(presenceResultSchema) {}
class VisitParamsDto extends createZodDto(z.object({ id: idSchema })) {}
class ServiceParamsDto extends createZodDto(z.object({ id: idSchema, serviceId: idSchema })) {}
class DiagnosisParamsDto extends createZodDto(z.object({ id: idSchema, recordId: idSchema })) {}
class PlanParamsDto extends createZodDto(z.object({ id: idSchema, planId: idSchema })) {}
/** A code that is not one of the 52 FDI codes → 400. */
class ToothParamsDto extends createZodDto(z.object({ id: idSchema, toothCode: toothCodeSchema })) {}
class PresenceParamsDto extends createZodDto(z.object({ id: idSchema, presenceId: idSchema })) {}

/**
 * Charting inside a live visit (docs/modules/clinical.md, spec §HTTP). Every route answers with
 * `{ visit, record }`: the updated visit (services and money), so the client replaces its cache
 * without a refetch, and the record the call created or changed (a removed one included).
 */
@Controller('visits')
export class VisitRecordsController {
  constructor(
    private readonly services: ServiceChartingService,
    private readonly diagnoses: DiagnosisChartingService,
    private readonly plans: PlanChartingService,
    private readonly presence: PresenceChartingService,
  ) {}

  // --- Services ---

  @Post(':id/services')
  @RequirePermission('visit:write')
  @ZodResponse({ status: 201, type: ServiceResultDto })
  addService(@Param() params: VisitParamsDto, @Body() body: AddServiceDto) {
    return this.services.addService(params.id, body);
  }

  @Patch(':id/services/:serviceId')
  @RequirePermission('visit:write')
  @ZodResponse({ type: ServiceResultDto })
  updateService(@Param() params: ServiceParamsDto, @Body() body: UpdateServiceDto) {
    return this.services.updateService(params.id, params.serviceId, body);
  }

  @Delete(':id/services/:serviceId')
  @RequirePermission('visit:write')
  @ZodResponse({ type: ServiceResultDto })
  removeService(@Param() params: ServiceParamsDto) {
    return this.services.removeService(params.id, params.serviceId);
  }

  /** Not finished: the service becomes work in progress; the answer's record is its plan. */
  @Post(':id/services/:serviceId/unfinished')
  @RequirePermission('visit:write')
  @HttpCode(HttpStatus.OK)
  @ZodResponse({ type: PlanResultDto })
  markServiceUnfinished(@Param() params: ServiceParamsDto) {
    return this.plans.markServiceUnfinished(params.id, params.serviceId);
  }

  // --- Diagnoses ---

  @Post(':id/diagnoses')
  @RequirePermission('visit:write')
  @ZodResponse({ status: 201, type: DiagnosisResultDto })
  recordDiagnosis(@Param() params: VisitParamsDto, @Body() body: RecordDiagnosisDto) {
    return this.diagnoses.recordDiagnosis(params.id, body);
  }

  @Post(':id/diagnoses/:recordId/resolve')
  @RequirePermission('visit:write')
  @HttpCode(HttpStatus.OK)
  @ZodResponse({ type: DiagnosisResultDto })
  resolveDiagnosis(@Param() params: DiagnosisParamsDto) {
    return this.diagnoses.resolveDiagnosis(params.id, params.recordId);
  }

  @Post(':id/diagnoses/:recordId/reopen')
  @RequirePermission('visit:write')
  @HttpCode(HttpStatus.OK)
  @ZodResponse({ type: DiagnosisResultDto })
  reopenDiagnosis(@Param() params: DiagnosisParamsDto) {
    return this.diagnoses.reopenDiagnosis(params.id, params.recordId);
  }

  /** What the diagnosis was seen on: the clinical exam, one of the patient's images, or null. */
  @Patch(':id/diagnoses/:recordId/seen-on')
  @RequirePermission('visit:write')
  @ZodResponse({ type: DiagnosisResultDto })
  setSeenOn(@Param() params: DiagnosisParamsDto, @Body() body: SeenOnDto) {
    return this.diagnoses.setSeenOn(params.id, params.recordId, body);
  }

  @Delete(':id/diagnoses/:recordId')
  @RequirePermission('visit:write')
  @ZodResponse({ type: DiagnosisResultDto })
  removeDiagnosis(@Param() params: DiagnosisParamsDto) {
    return this.diagnoses.removeDiagnosis(params.id, params.recordId);
  }

  // --- Plans ---

  @Post(':id/plans')
  @RequirePermission('visit:write')
  @ZodResponse({ status: 201, type: PlanResultDto })
  planTreatment(@Param() params: VisitParamsDto, @Body() body: PlanTreatmentDto) {
    return this.plans.planTreatment(params.id, body);
  }

  /** The phase of a plan made in this visit (the Plan step's priority control). */
  @Patch(':id/plans/:planId/priority')
  @RequirePermission('visit:write')
  @ZodResponse({ type: PlanResultDto })
  setPlanPriority(@Param() params: PlanParamsDto, @Body() body: PlanPriorityDto) {
    return this.plans.setPriority(params.id, params.planId, body);
  }

  /** The plan as performed; the service it became is in `visit.services`. */
  @Post(':id/plans/:planId/perform')
  @RequirePermission('visit:write')
  @HttpCode(HttpStatus.OK)
  @ZodResponse({ type: PlanResultDto })
  performPlan(@Param() params: PlanParamsDto) {
    return this.plans.performPlan(params.id, params.planId);
  }

  /** Continue today: this visit's session on a plan in progress. */
  @Put(':id/plans/:planId/session')
  @RequirePermission('visit:write')
  @ZodResponse({ type: PlanResultDto })
  recordSession(@Param() params: PlanParamsDto, @Body() body: RecordSessionDto) {
    return this.plans.recordSession(params.id, params.planId, body);
  }

  /** Not today: the Undo of Continue, or of Not finished in the visit that first worked on it. */
  @Delete(':id/plans/:planId/session')
  @RequirePermission('visit:write')
  @ZodResponse({ type: PlanResultDto })
  removeSession(@Param() params: PlanParamsDto) {
    return this.plans.removeSession(params.id, params.planId);
  }

  @Post(':id/plans/:planId/cancel')
  @RequirePermission('visit:write')
  @HttpCode(HttpStatus.OK)
  @ZodResponse({ type: PlanResultDto })
  cancelPlan(@Param() params: PlanParamsDto) {
    return this.plans.cancelPlan(params.id, params.planId);
  }

  @Delete(':id/plans/:planId')
  @RequirePermission('visit:write')
  @ZodResponse({ type: PlanResultDto })
  removePlan(@Param() params: PlanParamsDto) {
    return this.plans.removePlan(params.id, params.planId);
  }

  // --- Tooth presence ---

  /** Missing, not erupted, implant or present again; `record` is null when nothing changed. */
  @Put(':id/teeth/:toothCode/presence')
  @RequirePermission('visit:write')
  @ZodResponse({ type: PresenceResultDto })
  setPresence(@Param() params: ToothParamsDto, @Body() body: SetPresenceDto) {
    return this.presence.setPresence(params.id, params.toothCode, body);
  }

  /** The Undo of a presence set by hand in this visit. */
  @Delete(':id/presence/:presenceId')
  @RequirePermission('visit:write')
  @ZodResponse({ type: PresenceResultDto })
  removePresence(@Param() params: PresenceParamsDto) {
    return this.presence.removePresence(params.id, params.presenceId);
  }
}
