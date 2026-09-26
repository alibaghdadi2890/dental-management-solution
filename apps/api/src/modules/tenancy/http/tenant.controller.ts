import { tenantSchema, tenantSettingsPatchSchema } from '@dcm/contracts';
import { Body, Controller, Get, Patch } from '@nestjs/common';
import { createZodDto, ZodResponse } from 'nestjs-zod';
import { RequirePermission } from '../../../platform/http/route-access';
import { TenancyService } from '../application/tenancy.service';

class TenantDto extends createZodDto(tenantSchema) {}
class TenantSettingsPatchDto extends createZodDto(tenantSettingsPatchSchema) {}

/** The current tenant (from the session, or `X-Tenant-Id` for platform admins). */
@Controller('tenant')
export class TenantController {
  constructor(private readonly tenancy: TenancyService) {}

  @Get()
  @RequirePermission('tenant:read')
  @ZodResponse({ type: TenantDto })
  current() {
    return this.tenancy.currentTenant();
  }

  @Patch()
  @RequirePermission('tenant:write')
  @ZodResponse({ type: TenantDto })
  update(@Body() patch: TenantSettingsPatchDto) {
    return this.tenancy.updateSettings(patch);
  }
}
