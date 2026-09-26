import {
  platformTenantQuerySchema,
  platformTenantSchema,
  provisionTenantRequestSchema,
  tenantSchema,
  tenantStatusChangeSchema,
} from '@dcm/contracts';
import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query } from '@nestjs/common';
import { createZodDto, ZodResponse } from 'nestjs-zod';
import { RequirePermission } from '../../../platform/http/route-access';
import { ProvisioningService } from '../application/provisioning.service';

class PlatformTenantDto extends createZodDto(platformTenantSchema) {}
class PlatformTenantQueryDto extends createZodDto(platformTenantQuerySchema) {}
class ProvisionTenantDto extends createZodDto(provisionTenantRequestSchema) {}
class TenantDto extends createZodDto(tenantSchema) {}
class TenantStatusChangeDto extends createZodDto(tenantStatusChangeSchema) {}

/** Platform-admin API. The tenant is in the body or query, never in the path (ADR-0008). */
@Controller('platform/tenants')
@RequirePermission('platform:admin')
export class PlatformTenantsController {
  constructor(private readonly provisioning: ProvisioningService) {}

  @Get()
  @ZodResponse({ type: [PlatformTenantDto] })
  list(@Query() query: PlatformTenantQueryDto) {
    return this.provisioning.listTenants(query);
  }

  @Post()
  @ZodResponse({ status: 201, type: TenantDto })
  provision(@Body() body: ProvisionTenantDto) {
    return this.provisioning.provisionTenant(body);
  }

  @Post('suspend')
  @HttpCode(HttpStatus.OK)
  @ZodResponse({ type: TenantDto })
  suspend(@Body() body: TenantStatusChangeDto) {
    return this.provisioning.setTenantStatus(body.tenantId, 'suspended', body.reason);
  }

  @Post('reactivate')
  @HttpCode(HttpStatus.OK)
  @ZodResponse({ type: TenantDto })
  reactivate(@Body() body: TenantStatusChangeDto) {
    return this.provisioning.setTenantStatus(body.tenantId, 'active', body.reason);
  }
}
