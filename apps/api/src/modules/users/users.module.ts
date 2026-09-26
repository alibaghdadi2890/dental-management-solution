import { Module } from '@nestjs/common';
import { AuthModule } from '../auth';
import { TenancyModule } from '../tenancy';
import { SessionService } from './application/session.service';
import { SessionReadController } from './http/session-read.controller';

/** See docs/modules/users.md. */
@Module({
  imports: [AuthModule, TenancyModule],
  controllers: [SessionReadController],
  providers: [SessionService],
})
export class UsersModule {}
