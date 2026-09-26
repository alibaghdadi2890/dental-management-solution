import { AsyncLocalStorage } from 'node:async_hooks';
import { Inject, Injectable } from '@nestjs/common';
import { APP_DB, type Database, type Transaction } from '../../../platform/db/database';
import { TenantDb } from '../../../platform/db/tenant-db';

/**
 * Database access for the identity plane (ADR-0011). Its tables carry no tenant, so work runs on
 * the runtime role without `SET LOCAL`, but it joins whatever transaction is already open: a
 * tenant transaction (creating a staff user commits identity, profile and roles together) or an
 * explicit one handed over with `within()` (the platform-admin bootstrap).
 */
@Injectable()
export class IdentityDb {
  private readonly explicit = new AsyncLocalStorage<Transaction>();

  constructor(
    @Inject(APP_DB) private readonly db: Database,
    private readonly tenantDb: TenantDb,
  ) {}

  run<T>(work: (tx: Transaction) => Promise<T>): Promise<T> {
    const open = this.explicit.getStore() ?? this.tenantDb.currentTransaction();
    return open ? work(open) : this.db.transaction(work);
  }

  /** Runs several identity writes atomically: joins the open transaction or opens one. */
  atomic<T>(work: () => Promise<T>): Promise<T> {
    if (this.explicit.getStore() ?? this.tenantDb.currentTransaction()) {
      return work();
    }
    return this.db.transaction((tx) => this.within(tx, work));
  }

  within<T>(tx: Transaction, work: () => Promise<T>): Promise<T> {
    return this.explicit.run(tx, work);
  }
}
