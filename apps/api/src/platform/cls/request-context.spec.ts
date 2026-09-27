import { ClsServiceManager } from 'nestjs-cls';
import { describe, expect, it } from 'vitest';
import type { AppClsStore } from './app-cls-store';
import { PlatformAccessDeniedError } from '../kernel/platform-access-denied.error';
import { PermissionDeniedError } from './permission-denied.error';
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

describe('permissions carried in the context (ADR-0010)', () => {
  const user = { requestId: 'req-00000001', actorKind: 'user' as const, userId: 'u1' };

  it('denies everything outside a context or before permissions are resolved', async () => {
    expect(context.hasPermission('patient:read')).toBe(false);
    await context.run({ ...user, tenantId: 't1' }, () => {
      expect(context.hasPermission('patient:read')).toBe(false);
      return Promise.resolve();
    });
  });

  it('decides by the resolved set for users', async () => {
    await context.run({ ...user, tenantId: 't1' }, () => {
      context.setPermissions(['patient:read']);
      expect(context.hasPermission('patient:read')).toBe(true);
      expect(context.hasPermission('patient:write')).toBe(false);
      expect(context.grantedPermissions()).toEqual(['patient:read']);
      expect(() => {
        context.requirePermission('patient:write');
      }).toThrow(PermissionDeniedError);
      return Promise.resolve();
    });
  });

  it('grants a platform admin every permission inside a tenant, only platform:admin outside', async () => {
    await context.run({ ...user, platformAdmin: true }, () => {
      expect(context.hasPermission('platform:admin')).toBe(true);
      expect(context.hasPermission('tenant:write')).toBe(false);
      return Promise.resolve();
    });
    await context.run({ ...user, platformAdmin: true, tenantId: 't1' }, () => {
      expect(context.hasPermission('tenant:write')).toBe(true);
      expect(context.hasPermission('payment:refund')).toBe(true);
      expect(context.grantedPermissions()).toContain('audit:read');
      return Promise.resolve();
    });
  });

  it('keeps a platform-admin flag outside a user request as a fact for the audit, never authority', async () => {
    for (const actorKind of ['job', 'agent'] as const) {
      await context.run(
        { requestId: 'job:1', actorKind, tenantId: 't1', userId: 'admin', platformAdmin: true },
        async () => {
          expect(context.isPlatformAdmin).toBe(true);
          expect(context.actsAsPlatformAdmin).toBe(false);
          expect(context.hasPermission('patient:read')).toBe(false);
          expect(context.hasPermission('platform:admin')).toBe(false);
          await expect(context.runInTenant('t2', () => Promise.resolve())).rejects.toBeInstanceOf(
            PlatformAccessDeniedError,
          );
        },
      );
    }
    await context.run(
      { requestId: 'req-1', actorKind: 'user', tenantId: 't1', platformAdmin: true },
      () => {
        expect(context.actsAsPlatformAdmin).toBe(true);
        return Promise.resolve();
      },
    );
  });

  it('lets system tasks through', async () => {
    await context.run({ requestId: 'cli:1', actorKind: 'system' }, () => {
      expect(context.hasPermission('user:write')).toBe(true);
      return Promise.resolve();
    });
  });

  it('reports a forbidden domain error with a stable code', () => {
    const error = new PermissionDeniedError('tenant:write');
    expect(error.code).toBe('forbidden');
    expect(error.kind).toBe('forbidden');
  });
});

describe('establish()', () => {
  it('records the authenticated identity for the rest of the request', async () => {
    await context.run({ requestId: 'req-00000002', actorKind: 'user' }, () => {
      context.establish({ userId: 'u1', tenantId: 't1', branchId: 'b1', platformAdmin: false });
      expect(context.userId).toBe('u1');
      expect(context.tenantId).toBe('t1');
      expect(context.branchId).toBe('b1');
      expect(context.isPlatformAdmin).toBe(false);
      return Promise.resolve();
    });
  });
});

describe('runInTenant()', () => {
  it('enters a tenant as the same platform admin and request, then restores the outer context', async () => {
    await context.run(
      { requestId: 'req-00000003', actorKind: 'user', userId: 'admin', platformAdmin: true },
      async () => {
        await context.runInTenant('t9', () => {
          expect(context.tenantId).toBe('t9');
          expect(context.userId).toBe('admin');
          expect(context.requestId).toBe('req-00000003');
          expect(context.isPlatformAdmin).toBe(true);
          expect(context.branchId).toBeUndefined();
          return Promise.resolve();
        });
        expect(context.tenantId).toBeUndefined();
      },
    );
  });

  it('refuses ordinary users', async () => {
    await context.run({ requestId: 'req-00000004', actorKind: 'user', tenantId: 't1' }, () =>
      expect(context.runInTenant('t2', () => Promise.resolve())).rejects.toBeInstanceOf(
        PlatformAccessDeniedError,
      ),
    );
  });
});
