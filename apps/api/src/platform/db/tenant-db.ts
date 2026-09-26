import { AsyncLocalStorage } from 'node:async_hooks';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { RequestContext } from '../cls/request-context';
import { APP_DB, type Database, type Transaction } from './database';

type AfterCommitHook = () => void | Promise<void>;

interface OpenTransaction {
  tx: Transaction;
  tenantId: string;
  afterCommit: AfterCommitHook[];
}

/**
 * The only way repositories reach the database (CLAUDE.md §5). Every transaction starts with
 * `SET LOCAL app.tenant_id` from CLS; RLS does the filtering. Nested calls join the open
 * transaction, so an application service can span several repositories atomically.
 */
@Injectable()
export class TenantDb {
  private readonly logger = new Logger(TenantDb.name);
  private readonly open = new AsyncLocalStorage<OpenTransaction>();

  constructor(
    @Inject(APP_DB) private readonly db: Database,
    private readonly context: RequestContext,
  ) {}

  async run<T>(work: (tx: Transaction) => Promise<T>): Promise<T> {
    const tenantId = this.context.requireTenantId();
    const current = this.open.getStore();
    if (current) {
      if (current.tenantId !== tenantId) {
        throw new Error('Tenant changed inside an open transaction');
      }
      return work(current.tx);
    }

    const afterCommit: AfterCommitHook[] = [];
    const result = await this.db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.tenant_id', ${tenantId}, true)`);
      return this.open.run({ tx, tenantId, afterCommit }, () => work(tx));
    });
    await this.runAfterCommit(afterCommit);
    return result;
  }

  /** The transaction `run()` has open in this async context, for helpers that must join it. */
  currentTransaction(): Transaction | undefined {
    return this.open.getStore()?.tx;
  }

  /**
   * Defers `hook` until the open transaction commits; returns false when there is none, so the
   * caller can act immediately. Hooks are dropped if the transaction rolls back.
   */
  afterCommit(hook: AfterCommitHook): boolean {
    const current = this.open.getStore();
    if (!current) {
      return false;
    }
    current.afterCommit.push(hook);
    return true;
  }

  private async runAfterCommit(hooks: AfterCommitHook[]): Promise<void> {
    for (const hook of hooks) {
      try {
        await hook();
      } catch (error) {
        // The data is committed; a failing side effect must not turn success into an error.
        this.logger.error({ err: error }, 'after-commit hook failed');
      }
    }
  }
}
