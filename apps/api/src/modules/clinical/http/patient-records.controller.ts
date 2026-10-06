import {
  idSchema,
  patientChartResultSchema,
  planGroupInputSchema,
  planPatientTreatmentSchema,
  recordPatientDiagnosisSchema,
  updatePlanSchema,
} from '@dcm/contracts';
import { Body, Controller, Delete, Param, Patch, Post } from '@nestjs/common';
import { createZodDto, ZodResponse } from 'nestjs-zod';
import { z } from 'zod';
import { RequirePermission } from '../../../platform/http/route-access';
import { PatientRecordsService } from '../application/patient-records.service';

class RecordPatientDiagnosisDto extends createZodDto(recordPatientDiagnosisSchema) {}
class PlanPatientTreatmentDto extends createZodDto(planPatientTreatmentSchema) {}
class UpdatePlanDto extends createZodDto(updatePlanSchema) {}
class PlanGroupInputDto extends createZodDto(planGroupInputSchema) {}
class PatientChartResultDto extends createZodDto(patientChartResultSchema) {}
class PatientParamsDto extends createZodDto(z.object({ id: idSchema })) {}
class DiagnosisParamsDto extends createZodDto(z.object({ id: idSchema, recordId: idSchema })) {}
class PlanParamsDto extends createZodDto(z.object({ id: idSchema, planId: idSchema })) {}
class GroupParamsDto extends createZodDto(z.object({ id: idSchema, groupId: idSchema })) {}

/**
 * Charting on the patient record, outside a visit (docs/modules/clinical.md, ADR-0031):
 * diagnoses, plans and named plans. Every route needs `chart:write` and answers `{ chart }`, the
 * patient's chart as it now is, so the client replaces its cache without a refetch.
 */
@Controller('clinical/patients')
export class PatientRecordsController {
  constructor(private readonly records: PatientRecordsService) {}

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

  @Post(':id/plan-groups')
  @RequirePermission('chart:write')
  @ZodResponse({ status: 201, type: PatientChartResultDto })
  createGroup(@Param() params: PatientParamsDto, @Body() body: PlanGroupInputDto) {
    return this.records.createGroup(params.id, body);
  }

  @Patch(':id/plan-groups/:groupId')
  @RequirePermission('chart:write')
  @ZodResponse({ type: PatientChartResultDto })
  updateGroup(@Param() params: GroupParamsDto, @Body() body: PlanGroupInputDto) {
    return this.records.updateGroup(params.id, params.groupId, body);
  }

  @Delete(':id/plan-groups/:groupId')
  @RequirePermission('chart:write')
  @ZodResponse({ type: PatientChartResultDto })
  deleteGroup(@Param() params: GroupParamsDto) {
    return this.records.deleteGroup(params.id, params.groupId);
  }
}
