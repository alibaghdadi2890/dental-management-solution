// Public API of the auth module. Other modules import from this file only (CLAUDE.md §4).
export { AuthModule } from './auth.module';
export {
  AuthService,
  type BootstrapOutcome,
  type NewStaffIdentity,
} from './application/auth.service';
export { type AuthenticatedSession, TENANT_HEADER } from './application/session-resolver';
export { idleTimeoutSeconds } from './domain/session-activity';
export { AllowPendingPasswordChange, CurrentSession } from './http/session-access';
export { SessionGuard } from './http/session.guard';
