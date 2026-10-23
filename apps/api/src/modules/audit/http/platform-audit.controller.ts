import { platformAuditPageSchema, platformAuditQuerySchema } from '@dcm/contracts';
import { Controller, Get, Query } from '@nestjs/common';
import { createZodDto, ZodResponse } from 'nestjs-zod';
import { RequirePermission } from '../../../platform/http/route-access';
import { AuditService } from '../application/audit.service';

class PlatformAuditQueryDto extends createZodDto(platformAuditQuerySchema) {}
class PlatformAuditPageDto extends createZodDto(platformAuditPageSchema) {}

/** Every clinic's Activity, for platform admins (ADR-0057). */
@Controller('platform/audit')
export class PlatformAuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @RequirePermission('platform:admin')
  @ZodResponse({ type: PlatformAuditPageDto })
  list(@Query() query: PlatformAuditQueryDto) {
    return this.audit.listAcrossTenants(query);
  }
}
