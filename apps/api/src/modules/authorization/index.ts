// Public API of the authorization module. Other modules import from this file only (CLAUDE.md §4).
// Routes declare access with `Public`/`Authenticated`/`RequirePermission` from platform/http.
export { AuthorizationModule } from './authorization.module';
export { AuthorizationService } from './application/authorization.service';
