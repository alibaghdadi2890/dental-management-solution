import { changePasswordRequestSchema, switchBranchRequestSchema } from '@dcm/contracts';
import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { createZodDto } from 'nestjs-zod';
import { Authenticated } from '../../../platform/http/route-access';
import { SessionActionsService } from '../application/session-actions.service';
import type { AuthenticatedSession } from '../application/session-resolver';
import { AllowPendingPasswordChange, CurrentSession } from './session-access';

class SwitchBranchDto extends createZodDto(switchBranchRequestSchema) {}
class ChangePasswordDto extends createZodDto(changePasswordRequestSchema) {}

/** Session maintenance for the signed-in user. `GET /session` is served by `users`. */
@Controller('session')
export class SessionController {
  constructor(private readonly actions: SessionActionsService) {}

  /**
   * Idle heartbeat (D11): the SPA calls it at most once a minute while the user is active. The
   * session guard records the activity; there is nothing else to do.
   */
  @Post('touch')
  @Authenticated()
  @AllowPendingPasswordChange()
  @HttpCode(HttpStatus.NO_CONTENT)
  touch(): void {}

  @Post('branch')
  @Authenticated()
  @HttpCode(HttpStatus.NO_CONTENT)
  async switchBranch(
    @CurrentSession() session: AuthenticatedSession,
    @Body() body: SwitchBranchDto,
  ): Promise<void> {
    await this.actions.switchBranch(session, body.branchId);
  }

  @Post('password')
  @Authenticated()
  @AllowPendingPasswordChange()
  @HttpCode(HttpStatus.NO_CONTENT)
  async changePassword(
    @CurrentSession() session: AuthenticatedSession,
    @Body() body: ChangePasswordDto,
  ): Promise<void> {
    await this.actions.changePassword(session, body);
  }
}
