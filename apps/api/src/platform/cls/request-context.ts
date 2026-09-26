import { Injectable } from '@nestjs/common';
import { CLS_ID, ClsService } from 'nestjs-cls';
import type { ActorKind, AppClsStore } from './app-cls-store';

/** Thrown when tenant-scoped work runs without a tenant. Deliberately loud: it is a programming error. */
export class MissingTenantContextError extends Error {
  constructor() {
    super('No tenant in the current context; tenant-scoped work must run inside a request or job');
    this.name = 'MissingTenantContextError';
  }
}

export interface ContextSeed {
  requestId: string;
  actorKind: ActorKind;
  tenantId?: string;
  userId?: string;
  branchId?: string;
  platformAdmin?: boolean;
}

/** Typed, read-mostly access to the CLS store. */
@Injectable()
export class RequestContext {
  constructor(private readonly cls: ClsService<AppClsStore>) {}

  get requestId(): string | undefined {
    return this.cls.isActive() ? this.cls.getId() : undefined;
  }

  get tenantId(): string | undefined {
    return this.cls.isActive() ? this.cls.get('tenantId') : undefined;
  }

  get userId(): string | undefined {
    return this.cls.isActive() ? this.cls.get('userId') : undefined;
  }

  get actorKind(): ActorKind | undefined {
    return this.cls.isActive() ? this.cls.get('actorKind') : undefined;
  }

  get isPlatformAdmin(): boolean {
    return this.cls.isActive() && this.cls.get('platformAdmin') === true;
  }

  requireTenantId(): string {
    const tenantId = this.tenantId;
    if (!tenantId) {
      throw new MissingTenantContextError();
    }
    return tenantId;
  }

  /** Runs `fn` in a fresh context — used by job workers and system tasks, never inside requests. */
  run<T>(seed: ContextSeed, fn: () => Promise<T>): Promise<T> {
    return this.cls.run({ ifNested: 'override' }, () => {
      this.cls.set(CLS_ID, seed.requestId);
      this.cls.set('actorKind', seed.actorKind);
      this.cls.set('tenantId', seed.tenantId);
      this.cls.set('userId', seed.userId);
      this.cls.set('branchId', seed.branchId);
      this.cls.set('platformAdmin', seed.platformAdmin ?? false);
      return fn();
    });
  }
}
