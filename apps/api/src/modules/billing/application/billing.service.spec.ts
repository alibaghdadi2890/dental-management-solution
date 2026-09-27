import { ClsServiceManager } from 'nestjs-cls';
import { describe, expect, it, vi } from 'vitest';
import type { AppClsStore } from '../../../platform/cls/app-cls-store';
import { RequestContext } from '../../../platform/cls/request-context';
import type { TenantDb } from '../../../platform/db/tenant-db';
import { BillingService } from './billing.service';

const context = new RequestContext(ClsServiceManager.getClsService<AppClsStore>());

/** Only the context and the transaction runner matter: the guard runs before either is used. */
function service() {
  const tenantDb = { run: vi.fn() };
  const unused = undefined as never;
  const billing = new BillingService(
    context,
    tenantDb as unknown as TenantDb,
    unused,
    unused,
    unused,
    unused,
    unused,
    unused,
  );
  return { billing, tenantDb };
}

describe('BillingService.repointMergedEntries', () => {
  it('refuses to run for a user (or agent) actor, touching nothing', async () => {
    const { billing, tenantDb } = service();
    for (const actorKind of ['user', 'agent'] as const) {
      await expect(
        context.run(
          { requestId: 'req-1', actorKind, tenantId: 't1', userId: 'u1', platformAdmin: true },
          () => billing.repointMergedEntries('kept', 'dropped'),
        ),
      ).rejects.toThrow(/only in the merge job/);
    }
    expect(tenantDb.run).not.toHaveBeenCalled();
  });
});
