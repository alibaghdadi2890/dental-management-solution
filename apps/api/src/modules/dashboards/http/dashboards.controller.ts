import {
  dashboardQuerySchema,
  financialCostsSchema,
  financialDentistsSchema,
  financialMoneySchema,
  financialOwesSchema,
  financialPlansSchema,
  financialReceivablesSchema,
  financialServicesSchema,
  operationalAppointmentsSchema,
  operationalAttentionSchema,
  operationalBusyHoursSchema,
  operationalDentistsSchema,
  operationalFollowUpsSchema,
  operationalLabsSchema,
  operationalPatientsSchema,
  operationalPlansSchema,
  operationalVisitsSchema,
} from '@dcm/contracts';
import { Controller, Get, Query } from '@nestjs/common';
import { createZodDto, ZodResponse } from 'nestjs-zod';
import { RequirePermission } from '../../../platform/http/route-access';
import { FinancialDashboardService } from '../application/financial-dashboard.service';
import { OperationalDashboardService } from '../application/operational-dashboard.service';

class DashboardQueryDto extends createZodDto(dashboardQuerySchema) {}
class MoneyDto extends createZodDto(financialMoneySchema) {}
class CostsDto extends createZodDto(financialCostsSchema) {}
class ReceivablesDto extends createZodDto(financialReceivablesSchema) {}
class FinancialDentistsDto extends createZodDto(financialDentistsSchema) {}
class ServicesDto extends createZodDto(financialServicesSchema) {}
class PlanValueDto extends createZodDto(financialPlansSchema) {}
class OwesDto extends createZodDto(financialOwesSchema) {}
class AppointmentsDto extends createZodDto(operationalAppointmentsSchema) {}
class BusyHoursDto extends createZodDto(operationalBusyHoursSchema) {}
class VisitsDto extends createZodDto(operationalVisitsSchema) {}
class PatientsDto extends createZodDto(operationalPatientsSchema) {}
class PlanStagesDto extends createZodDto(operationalPlansSchema) {}
class OperationalDentistsDto extends createZodDto(operationalDentistsSchema) {}
class LabsDto extends createZodDto(operationalLabsSchema) {}
class FollowUpsDto extends createZodDto(operationalFollowUpsSchema) {}
class AttentionDto extends createZodDto(operationalAttentionSchema) {}

/**
 * The dashboards (feature 19, docs/modules/dashboards.md): one read per card, so each card loads
 * and fails on its own. Viewing is not audited. Every service re-checks the tab's permission and
 * each part's home permission.
 */
@Controller('dashboards')
export class DashboardsController {
  constructor(
    private readonly financial: FinancialDashboardService,
    private readonly operational: OperationalDashboardService,
  ) {}

  @Get('financial/money')
  @RequirePermission('dashboard:financial')
  @ZodResponse({ type: MoneyDto })
  money(@Query() query: DashboardQueryDto) {
    return this.financial.money(query);
  }

  @Get('financial/costs')
  @RequirePermission('dashboard:financial')
  @ZodResponse({ type: CostsDto })
  costs(@Query() query: DashboardQueryDto) {
    return this.financial.costs(query);
  }

  @Get('financial/receivables')
  @RequirePermission('dashboard:financial')
  @ZodResponse({ type: ReceivablesDto })
  receivables() {
    return this.financial.receivables();
  }

  @Get('financial/dentists')
  @RequirePermission('dashboard:financial')
  @ZodResponse({ type: FinancialDentistsDto })
  financialDentists(@Query() query: DashboardQueryDto) {
    return this.financial.dentists(query);
  }

  @Get('financial/services')
  @RequirePermission('dashboard:financial')
  @ZodResponse({ type: ServicesDto })
  services(@Query() query: DashboardQueryDto) {
    return this.financial.services(query);
  }

  @Get('financial/plans')
  @RequirePermission('dashboard:financial')
  @ZodResponse({ type: PlanValueDto })
  planValue() {
    return this.financial.plans();
  }

  @Get('financial/owes')
  @RequirePermission('dashboard:financial')
  @ZodResponse({ type: OwesDto })
  owes() {
    return this.financial.owes();
  }

  @Get('operational/appointments')
  @RequirePermission('dashboard:operational')
  @ZodResponse({ type: AppointmentsDto })
  appointments(@Query() query: DashboardQueryDto) {
    return this.operational.appointments(query);
  }

  @Get('operational/busy-hours')
  @RequirePermission('dashboard:operational')
  @ZodResponse({ type: BusyHoursDto })
  busyHours(@Query() query: DashboardQueryDto) {
    return this.operational.busyHours(query);
  }

  @Get('operational/visits')
  @RequirePermission('dashboard:operational')
  @ZodResponse({ type: VisitsDto })
  visits(@Query() query: DashboardQueryDto) {
    return this.operational.visits(query);
  }

  @Get('operational/patients')
  @RequirePermission('dashboard:operational')
  @ZodResponse({ type: PatientsDto })
  patients(@Query() query: DashboardQueryDto) {
    return this.operational.patientsCard(query);
  }

  @Get('operational/plans')
  @RequirePermission('dashboard:operational')
  @ZodResponse({ type: PlanStagesDto })
  plans(@Query() query: DashboardQueryDto) {
    return this.operational.plans(query);
  }

  @Get('operational/dentists')
  @RequirePermission('dashboard:operational')
  @ZodResponse({ type: OperationalDentistsDto })
  operationalDentists(@Query() query: DashboardQueryDto) {
    return this.operational.dentists(query);
  }

  @Get('operational/labs')
  @RequirePermission('dashboard:operational')
  @ZodResponse({ type: LabsDto })
  labs(@Query() query: DashboardQueryDto) {
    return this.operational.labsCard(query);
  }

  @Get('operational/follow-ups')
  @RequirePermission('dashboard:operational')
  @ZodResponse({ type: FollowUpsDto })
  followUps(@Query() query: DashboardQueryDto) {
    return this.operational.followUps(query);
  }

  @Get('operational/attention')
  @RequirePermission('dashboard:operational')
  @ZodResponse({ type: AttentionDto })
  attention(@Query() query: DashboardQueryDto) {
    return this.operational.attention(query);
  }
}
