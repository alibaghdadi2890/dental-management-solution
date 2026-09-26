import { Module } from '@nestjs/common';
import { AuditService } from './application/audit.service';
import { DomainEventAuditSubscriber } from './application/domain-event.subscriber';
import { AuditController } from './http/audit.controller';
import { AuditRepository } from './persistence/audit.repository';

/** See docs/modules/audit.md. */
@Module({
  controllers: [AuditController],
  providers: [AuditRepository, AuditService, DomainEventAuditSubscriber],
  exports: [AuditService],
})
export class AuditModule {}
