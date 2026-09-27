import { ClsServiceManager } from 'nestjs-cls';
import { describe, expect, it, vi } from 'vitest';
import type { AppClsStore } from '../../../platform/cls/app-cls-store';
import { type ContextSeed, RequestContext } from '../../../platform/cls/request-context';
import type { TenantDb } from '../../../platform/db/tenant-db';
import type { DomainPatient } from '../domain/patient';
import type { PatientsRepository } from '../persistence/patients.repository';
import { PatientsService } from './patients.service';

const context = new RequestContext(ClsServiceManager.getClsService<AppClsStore>());
const JOB: ContextSeed = { requestId: 'req-1', actorKind: 'job', tenantId: 't1' };

/** `mergedIntoId` per patient id; ids absent from the map are unknown (another tenant). */
function setup(chain: Record<string, string | null>, inTransaction = true) {
  const findForShare = vi.fn((id: string) =>
    Promise.resolve(
      id in chain ? ({ id, mergedIntoId: chain[id] ?? null } as DomainPatient) : undefined,
    ),
  );
  const tenantDb = { currentTransaction: () => (inTransaction ? {} : undefined) };
  const unused = undefined as never;
  const service = new PatientsService(
    context,
    tenantDb as unknown as TenantDb,
    unused,
    unused,
    unused,
    unused,
    { findForShare } as unknown as PatientsRepository,
    unused,
    unused,
  );
  return { service, findForShare };
}

describe('PatientsService.survivorOf', () => {
  it('follows mergedIntoId to the surviving patient, locking each hop', async () => {
    const { service, findForShare } = setup({ a: 'b', b: 'c', c: null });
    await expect(context.run(JOB, () => service.survivorOf('a'))).resolves.toBe('c');
    expect(findForShare.mock.calls.map(([id]) => id)).toEqual(['a', 'b', 'c']);
    await expect(context.run(JOB, () => service.survivorOf('c'))).resolves.toBe('c');
  });

  it('returns null for a patient this tenant does not have, or a broken link', async () => {
    const { service } = setup({ a: 'gone' });
    await expect(context.run(JOB, () => service.survivorOf('nobody'))).resolves.toBeNull();
    await expect(context.run(JOB, () => service.survivorOf('a'))).resolves.toBeNull();
  });

  it('refuses a cycle', async () => {
    const { service } = setup({ a: 'b', b: 'a' });
    await expect(context.run(JOB, () => service.survivorOf('a'))).rejects.toThrow(/cycle/);
  });

  it('refuses an absurdly long chain', async () => {
    const chain = Object.fromEntries(
      Array.from({ length: 150 }, (_, index) => [`p${String(index)}`, `p${String(index + 1)}`]),
    );
    const { service } = setup(chain);
    await expect(context.run(JOB, () => service.survivorOf('p0'))).rejects.toThrow(/longer than/);
  });

  it('runs only for a job or system actor, inside a transaction', async () => {
    const { service, findForShare } = setup({ a: null });
    await expect(
      context.run({ ...JOB, actorKind: 'user', userId: 'u1', platformAdmin: true }, () =>
        service.survivorOf('a'),
      ),
    ).rejects.toThrow(/only in a job or system task/);
    await expect(
      context.run({ ...JOB, actorKind: 'system' }, () => service.survivorOf('a')),
    ).resolves.toBe('a');

    const outside = setup({ a: null }, false);
    await expect(context.run(JOB, () => outside.service.survivorOf('a'))).rejects.toThrow(
      /inside a transaction/,
    );
    expect(outside.findForShare).not.toHaveBeenCalled();
    expect(findForShare).toHaveBeenCalledOnce();
  });
});
