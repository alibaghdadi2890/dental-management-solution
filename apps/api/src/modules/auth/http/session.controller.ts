import { Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { Authenticated } from '../../../platform/http/route-access';
import { AllowPendingPasswordChange } from './session-access';

/** Session maintenance for the signed-in user. `GET /session` is served by `users`. */
@Controller('session')
export class SessionController {
  /**
   * Idle heartbeat (D11): the SPA calls it at most once a minute while the user is active. The
   * session guard records the activity; there is nothing else to do.
   */
  @Post('touch')
  @Authenticated()
  @AllowPendingPasswordChange()
  @HttpCode(HttpStatus.NO_CONTENT)
  touch(): void {}
}
