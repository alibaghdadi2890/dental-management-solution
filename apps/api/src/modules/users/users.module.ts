import { Module } from '@nestjs/common';
import { AuthModule } from '../auth';
import { SessionService } from './application/session.service';
import { SessionReadController } from './http/session-read.controller';

/** See docs/modules/users.md. */
@Module({
  imports: [AuthModule],
  controllers: [SessionReadController],
  providers: [SessionService],
})
export class UsersModule {}
