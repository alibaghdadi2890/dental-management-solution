import { sessionSchema } from '@dcm/contracts';
import { Controller, Get } from '@nestjs/common';
import { createZodDto, ZodResponse } from 'nestjs-zod';
import { Authenticated } from '../../../platform/http/route-access';
import { AllowPendingPasswordChange, type AuthenticatedSession, CurrentSession } from '../../auth';
import { SessionService } from '../application/session.service';

class SessionDto extends createZodDto(sessionSchema) {}

@Controller('session')
export class SessionReadController {
  constructor(private readonly sessions: SessionService) {}

  @Get()
  @Authenticated()
  @AllowPendingPasswordChange()
  @ZodResponse({ type: SessionDto })
  current(@CurrentSession() session: AuthenticatedSession) {
    return this.sessions.current(session);
  }
}
