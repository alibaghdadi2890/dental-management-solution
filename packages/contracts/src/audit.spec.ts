import { describe, expect, it } from 'vitest';
import { auditEntrySchema, auditQuerySchema } from './audit.js';

describe('auditEntrySchema', () => {
  it('round-trips an entry recorded by a platform admin', () => {
    const entry = {
      id: '01928c6e-7b8a-7cc2-9d7e-3f1a2b4c5d6e',
      actorUserId: '01928c6e-7b8a-7cc2-9d7e-3f1a2b4c5d6f',
      actorKind: 'user',
      actorPlatformAdmin: true,
      action: 'branch.update',
      resourceType: 'branch',
      resourceId: '01928c6e-7b8a-7cc2-9d7e-3f1a2b4c5d70',
      before: { name: 'Main' },
      after: { name: 'Main St' },
      reason: null,
      requestId: 'req-00000001',
      occurredAt: '2026-09-26T10:00:00.000Z',
    };
    expect(auditEntrySchema.parse(entry)).toEqual(entry);
  });
});

describe('auditQuerySchema', () => {
  it('filters by resource and paginates by cursor', () => {
    expect(auditQuerySchema.parse({ resourceType: 'branch', limit: '5' })).toEqual({
      resourceType: 'branch',
      limit: 5,
    });
  });
});
