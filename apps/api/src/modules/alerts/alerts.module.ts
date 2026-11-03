import { Module } from '@nestjs/common';
import { AuditModule } from '../audit';
import { ClinicalModule } from '../clinical';
import { SchedulingModule } from '../scheduling';
import { UsersModule } from '../users';
import { AlertHub } from './application/alert-hub';
import { AlertsService } from './application/alerts.service';
import { AlertsSubscriber } from './application/alerts.subscriber';
import { AlertsController } from './http/alerts.controller';
import { AlertFollowsRepository } from './persistence/alert-follows.repository';

/**
 * See docs/modules/alerts.md and ADR-0073. Depends on `scheduling` (who is waiting), `clinical`
 * (who is in a room), `users` (the dentists) and `audit`. Nothing imports it.
 */
@Module({
  imports: [AuditModule, ClinicalModule, SchedulingModule, UsersModule],
  controllers: [AlertsController],
  providers: [AlertHub, AlertsService, AlertsSubscriber, AlertFollowsRepository],
})
export class AlertsModule {}
