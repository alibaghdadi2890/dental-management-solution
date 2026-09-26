import type { INestApplication } from '@nestjs/common';
import type { Tenant } from '@dcm/contracts';
import { TenancyService } from '../../src/modules/tenancy';
import { RequestContext } from '../../src/platform/cls/request-context';
import { newId } from '../../src/platform/kernel/id';

/** A tenant row with no branches or users, created as a platform admin would. */
export function createBareTenant(app: INestApplication, name = 'Test Clinic'): Promise<Tenant> {
  const id = newId();
  return app
    .get(RequestContext)
    .run({ requestId: `test-${id}`, actorKind: 'user', userId: newId(), platformAdmin: true }, () =>
      app.get(TenancyService).createTenant({
        id,
        name,
        slug: `t-${id.slice(-12)}`,
        timeZone: 'Asia/Beirut',
        currency: 'USD',
        locale: 'en',
      }),
    );
}

/** Runs `fn` as a platform admin acting inside `tenantId` (ADR-0008), calling services directly. */
export function asPlatformAdminIn<T>(
  app: INestApplication,
  tenantId: string,
  fn: () => Promise<T>,
): Promise<T> {
  return app
    .get(RequestContext)
    .run(
      { requestId: `test-${newId()}`, actorKind: 'user', userId: newId(), platformAdmin: true },
      () => app.get(RequestContext).runInTenant(tenantId, fn),
    );
}
