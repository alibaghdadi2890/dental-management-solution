import type { Permission } from '@dcm/contracts';
import { Injectable } from '@nestjs/common';
import { CLS_ID, ClsService } from 'nestjs-cls';
import { PlatformAccessDeniedError } from '../kernel/platform-access-denied.error';
import type { ActorKind, AppClsStore } from './app-cls-store';
import { PermissionDeniedError } from './permission-denied.error';

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

/** What the session guard learns about the caller. */
export interface AuthenticatedIdentity {
  userId: string;
  tenantId: string | undefined;
  branchId: string | undefined;
  platformAdmin: boolean;
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

  get branchId(): string | undefined {
    return this.cls.isActive() ? this.cls.get('branchId') : undefined;
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

  requireUserId(): string {
    const userId = this.userId;
    if (!userId) {
      throw new Error('No user in the current context');
    }
    return userId;
  }

  /** Called once per request by the session guard, the edge that authenticates. */
  establish(identity: AuthenticatedIdentity): void {
    this.cls.set('actorKind', 'user');
    this.cls.set('userId', identity.userId);
    this.cls.set('tenantId', identity.tenantId);
    this.cls.set('branchId', identity.branchId);
    this.cls.set('platformAdmin', identity.platformAdmin);
  }

  /** Called by `authorization` once the actor's roles are known (ADR-0010). */
  setPermissions(permissions: Iterable<Permission>): void {
    this.cls.set('permissions', new Set(permissions));
  }

  /**
   * The single permission evaluation every layer uses (ADR-0010). System tasks pass; a platform
   * admin holds every permission inside a tenant and only `platform:admin` outside one (ADR-0008);
   * everyone else is decided by the set `authorization` resolved. Deny by default.
   */
  hasPermission(permission: Permission): boolean {
    if (!this.cls.isActive()) {
      return false;
    }
    if (this.actorKind === 'system') {
      return true;
    }
    if (this.isPlatformAdmin) {
      return this.tenantId !== undefined || permission === 'platform:admin';
    }
    return this.cls.get('permissions')?.has(permission) ?? false;
  }

  /** Re-check inside application services: the route guard is not the last line of defence. */
  requirePermission(permission: Permission): void {
    if (!this.hasPermission(permission)) {
      throw new PermissionDeniedError(permission);
    }
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

  /**
   * Platform admins and system tasks enter a tenant programmatically (provisioning, suspension)
   * as the same actor and request (ADR-0008). Tenant data is then reached under RLS as usual.
   */
  runInTenant<T>(tenantId: string, fn: () => Promise<T>): Promise<T> {
    if (!this.isPlatformAdmin && this.actorKind !== 'system') {
      return Promise.reject(
        new PlatformAccessDeniedError('Entering another tenant requires platform:admin'),
      );
    }
    const userId = this.userId;
    return this.run(
      {
        requestId: this.requestId ?? tenantId,
        actorKind: this.actorKind ?? 'system',
        tenantId,
        ...(userId === undefined ? {} : { userId }),
        platformAdmin: this.isPlatformAdmin,
      },
      fn,
    );
  }
}
