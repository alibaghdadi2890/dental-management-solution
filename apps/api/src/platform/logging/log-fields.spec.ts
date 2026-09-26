import { ClsServiceManager } from 'nestjs-cls';
import { describe, expect, it } from 'vitest';
import type { AppClsStore } from '../cls/app-cls-store';
import { RequestContext } from '../cls/request-context';
import { clsLogFields, pathOnly } from './log-fields';

describe('clsLogFields', () => {
  it('is empty outside a context', () => {
    expect(clsLogFields()).toEqual({});
  });

  it('carries request, tenant and user ids from CLS', async () => {
    const context = new RequestContext(ClsServiceManager.getClsService<AppClsStore>());
    await context.run(
      { requestId: 'req-12345678', actorKind: 'user', tenantId: 't1', userId: 'u1' },
      () => {
        expect(clsLogFields()).toEqual({ requestId: 'req-12345678', tenantId: 't1', userId: 'u1' });
        return Promise.resolve();
      },
    );
  });
});

describe('pathOnly', () => {
  it('drops query strings that may contain patient names', () => {
    expect(pathOnly('/api/v1/patients?search=Jane%20Doe')).toBe('/api/v1/patients');
    expect(pathOnly(undefined)).toBeUndefined();
  });
});
