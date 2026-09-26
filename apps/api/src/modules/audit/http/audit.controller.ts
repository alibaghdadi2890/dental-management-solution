import { auditPageSchema, auditQuerySchema } from '@dcm/contracts';
import { Controller, Get, Query } from '@nestjs/common';
import { createZodDto, ZodResponse } from 'nestjs-zod';
import { RequirePermission } from '../../../platform/http/route-access';
import { AuditService } from '../application/audit.service';

class AuditQueryDto extends createZodDto(auditQuerySchema) {}
class AuditPageDto extends createZodDto(auditPageSchema) {}

@Controller('audit')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @RequirePermission('audit:read')
  @ZodResponse({ type: AuditPageDto })
  list(@Query() query: AuditQueryDto) {
    return this.audit.list(query);
  }
}
