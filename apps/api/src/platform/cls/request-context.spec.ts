import { ClsServiceManager } from 'nestjs-cls';
import { describe, expect, it } from 'vitest';
import type { AppClsStore } from './app-cls-store';
import { MissingTenantContextError, RequestContext } from './request-context';

const context = new RequestContext(ClsServiceManager.getClsService<AppClsStore>());

describe('RequestContext', () => {
  it('reports nothing outside an active context', () => {
    expect(context.tenantId).toBeUndefined();
    expect(context.requestId).toBeUndefined();
    expect(context.isPlatformAdmin).toBe(false);
    expect(() => context.requireTenantId()).toThrow(MissingTenantContextError);
  });

  it('exposes the seeded context inside run()', async () => {
    await context.run(
      { requestId: 'job:1', actorKind: 'job', tenantId: 'tenant-a', userId: 'user-1' },
      () => {
        expect(context.requestId).toBe('job:1');
        expect(context.requireTenantId()).toBe('tenant-a');
        expect(context.userId).toBe('user-1');
        expect(context.actorKind).toBe('job');
        expect(context.isPlatformAdmin).toBe(false);
        return Promise.resolve();
      },
    );
  });

  it('does not leak an outer tenant into a nested run', async () => {
    await context.run({ requestId: 'outer', actorKind: 'user', tenantId: 'tenant-a' }, () =>
      context.run({ requestId: 'inner', actorKind: 'system' }, () => {
        expect(context.tenantId).toBeUndefined();
        expect(context.requestId).toBe('inner');
        return Promise.resolve();
      }),
    );
  });
});
