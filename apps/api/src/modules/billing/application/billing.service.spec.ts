import { Logger } from '@nestjs/common';
import { ClsServiceManager } from 'nestjs-cls';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppClsStore } from '../../../platform/cls/app-cls-store';
import { type ContextSeed, RequestContext } from '../../../platform/cls/request-context';
import type { TenantDb } from '../../../platform/db/tenant-db';
import type { AuditService } from '../../audit';
import type { PatientsService } from '../../patients';
import type { LedgerEntriesRepository } from '../persistence/ledger-entries.repository';
import type { PaymentsRepository } from '../persistence/payments.repository';
import type { Settlement } from './settlement';
import { BillingService } from './billing.service';

const context = new RequestContext(ClsServiceManager.getClsService<AppClsStore>());
const JOB: ContextSeed = { requestId: 'req-1', actorKind: 'job', tenantId: 't1' };

/** `survivors` maps a patient id to what `survivorOf` answers (absent → null). */
function service(survivors: Record<string, string> = {}) {
  const tenantDb = { run: vi.fn((work: () => Promise<unknown>) => work()) };
  const patients = { survivorOf: vi.fn((id: string) => Promise.resolve(survivors[id] ?? null)) };
  const entries = { repointPatient: vi.fn(() => Promise.resolve(2)) };
  const audit = { record: vi.fn(() => Promise.resolve()) };
  const settlement = {
    lock: vi.fn(() => Promise.resolve()),
    settle: vi.fn(() => Promise.resolve([])),
  };
  const payments = { repointPatient: vi.fn(() => Promise.resolve(1)) };
  const unused = undefined as never;
  const billing = new BillingService(
    context,
    tenantDb as unknown as TenantDb,
    unused,
    audit as unknown as AuditService,
    unused,
    patients as unknown as PatientsService,
    entries as unknown as LedgerEntriesRepository,
    unused,
    unused,
    settlement as unknown as Settlement,
    unused,
    payments as unknown as PaymentsRepository,
  );
  return { billing, tenantDb, entries, audit, settlement };
}

describe('BillingService.repointMergedEntries', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

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

  it('moves the entries and payments to the survivor both patients share, audits it and settles', async () => {
    const { billing, entries, audit, settlement } = service({ kept: 'final', dropped: 'final' });
    await expect(
      context.run(JOB, () => billing.repointMergedEntries('kept', 'dropped')),
    ).resolves.toBe(2);
    expect(entries.repointPatient).toHaveBeenCalledWith('dropped', 'final');
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'ledger_entry.repoint',
        resourceId: 'final',
        after: { droppedId: 'dropped', keptId: 'kept', count: 2, payments: 1 },
      }),
    );
    expect(settlement.settle).toHaveBeenCalledWith('final');
  });

  it('moves nothing, logging ids only, unless the dropped patient was merged into the kept chain', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const mismatches: Record<string, string>[] = [
      { kept: 'kept', dropped: 'dropped' },
      { kept: 'kept', dropped: 'elsewhere' },
      { dropped: 'kept' },
      { kept: 'kept' },
    ];
    for (const survivors of mismatches) {
      const { billing, entries, audit } = service(survivors);
      await expect(
        context.run(JOB, () => billing.repointMergedEntries('kept', 'dropped')),
      ).resolves.toBe(0);
      expect(entries.repointPatient).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    }
    expect(warn).toHaveBeenCalledTimes(4);
    expect(warn.mock.calls[0]?.[0]).toEqual({ keptId: 'kept', droppedId: 'dropped' });
  });
});
