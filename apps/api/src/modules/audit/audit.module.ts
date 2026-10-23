import { Module } from '@nestjs/common';
import { AuditService } from './application/audit.service';
import { AuditVisitScope } from './application/audit-visit-scope';
import { DomainEventAuditSubscriber } from './application/domain-event.subscriber';
import { AuditController } from './http/audit.controller';
import { PlatformAuditController } from './http/platform-audit.controller';
import { AuditRepository } from './persistence/audit.repository';

/** See docs/modules/audit.md. */
@Module({
  controllers: [AuditController, PlatformAuditController],
  providers: [AuditRepository, AuditService, AuditVisitScope, DomainEventAuditSubscriber],
  exports: [AuditService, AuditVisitScope],
})
export class AuditModule {}
