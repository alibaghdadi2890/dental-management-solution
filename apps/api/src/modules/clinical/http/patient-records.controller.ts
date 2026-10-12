import {
  idSchema,
  patientChartResultSchema,
  patientPresenceResultSchema,
  planPatientTreatmentSchema,
  recordPatientDiagnosisSchema,
  removePresenceQuerySchema,
  seenOnInputSchema,
  setPresenceOnPatientSchema,
  updatePlanSchema,
} from '@dcm/contracts';
import { Body, Controller, Delete, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { createZodDto, ZodResponse } from 'nestjs-zod';
import { z } from 'zod';
import { RequirePermission } from '../../../platform/http/route-access';
import { PatientRecordsService } from '../application/records/patient-records.service';

class RecordPatientDiagnosisDto extends createZodDto(recordPatientDiagnosisSchema) {}
class PlanPatientTreatmentDto extends createZodDto(planPatientTreatmentSchema) {}
class UpdatePlanDto extends createZodDto(updatePlanSchema) {}
class SeenOnDto extends createZodDto(seenOnInputSchema) {}
class PatientChartResultDto extends createZodDto(patientChartResultSchema) {}
class SetPresenceDto extends createZodDto(setPresenceOnPatientSchema) {}
class RemovePresenceQueryDto extends createZodDto(removePresenceQuerySchema) {}
class PatientPresenceResultDto extends createZodDto(patientPresenceResultSchema) {}
class PatientParamsDto extends createZodDto(z.object({ id: idSchema })) {}
class DiagnosisParamsDto extends createZodDto(z.object({ id: idSchema, recordId: idSchema })) {}
class PlanParamsDto extends createZodDto(z.object({ id: idSchema, planId: idSchema })) {}

/**
 * Charting on the patient record, outside a visit (docs/modules/clinical.md, ADR-0031):
 * diagnoses, plans — their priority and the patient's acceptance too (ADR-0045) — and tooth
 * presence. Every route needs `chart:write` and answers `{ chart }`, the patient's chart as it
 * now is, so the client replaces its cache without a refetch.
 */
@Controller('clinical/patients')
export class PatientRecordsController {
  constructor(private readonly records: PatientRecordsService) {}

  /** One or several teeth, with one When, reason and dentist (the menu, or Edit presence). */
  @Post(':id/presence')
  @RequirePermission('chart:write')
  @ZodResponse({ status: 201, type: PatientPresenceResultDto })
  setPresence(@Param() params: PatientParamsDto, @Body() body: SetPresenceDto) {
    return this.records.setPresence(params.id, body);
  }

  /** The Undo of a presence set on the patient record. */
  @Delete(':id/presence')
  @RequirePermission('chart:write')
  @ZodResponse({ type: PatientChartResultDto })
  removePresence(@Param() params: PatientParamsDto, @Query() query: RemovePresenceQueryDto) {
    return this.records.removePresence(params.id, query.ids);
  }

  @Post(':id/diagnoses')
  @RequirePermission('chart:write')
  @ZodResponse({ status: 201, type: PatientChartResultDto })
  recordDiagnosis(@Param() params: PatientParamsDto, @Body() body: RecordPatientDiagnosisDto) {
    return this.records.recordDiagnosis(params.id, body);
  }

  @Delete(':id/diagnoses/:recordId')
  @RequirePermission('chart:write')
  @ZodResponse({ type: PatientChartResultDto })
  removeDiagnosis(@Param() params: DiagnosisParamsDto) {
    return this.records.removeDiagnosis(params.id, params.recordId);
  }

  @Patch(':id/diagnoses/:recordId/seen-on')
  @RequirePermission('chart:write')
  @ZodResponse({ type: PatientChartResultDto })
  setSeenOn(@Param() params: DiagnosisParamsDto, @Body() body: SeenOnDto) {
    return this.records.setSeenOn(params.id, params.recordId, body);
  }

  @Post(':id/plans')
  @RequirePermission('chart:write')
  @ZodResponse({ status: 201, type: PatientChartResultDto })
  planTreatment(@Param() params: PatientParamsDto, @Body() body: PlanPatientTreatmentDto) {
    return this.records.planTreatment(params.id, body);
  }

  @Patch(':id/plans/:planId')
  @RequirePermission('chart:write')
  @ZodResponse({ type: PatientChartResultDto })
  updatePlan(@Param() params: PlanParamsDto, @Body() body: UpdatePlanDto) {
    return this.records.updatePlan(params.id, params.planId, body);
  }

  /** The patient accepted the proposed treatment; DELETE withdraws it while still planned. */
  @Put(':id/plans/:planId/acceptance')
  @RequirePermission('chart:write')
  @ZodResponse({ type: PatientChartResultDto })
  acceptPlan(@Param() params: PlanParamsDto) {
    return this.records.setAcceptance(params.id, params.planId, true);
  }

  @Delete(':id/plans/:planId/acceptance')
  @RequirePermission('chart:write')
  @ZodResponse({ type: PatientChartResultDto })
  unacceptPlan(@Param() params: PlanParamsDto) {
    return this.records.setAcceptance(params.id, params.planId, false);
  }

  @Post(':id/plans/:planId/cancel')
  @RequirePermission('chart:write')
  @ZodResponse({ status: 200, type: PatientChartResultDto })
  cancelPlan(@Param() params: PlanParamsDto) {
    return this.records.cancelPlan(params.id, params.planId);
  }

  @Delete(':id/plans/:planId')
  @RequirePermission('chart:write')
  @ZodResponse({ type: PatientChartResultDto })
  removePlan(@Param() params: PlanParamsDto) {
    return this.records.removePlan(params.id, params.planId);
  }
}
