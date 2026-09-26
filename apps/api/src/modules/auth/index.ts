// Public API of the auth module. Other modules import from this file only (CLAUDE.md §4).
export { AuthModule } from './auth.module';
export {
  AuthService,
  type BootstrapOutcome,
  type NewStaffIdentity,
} from './application/auth.service';
