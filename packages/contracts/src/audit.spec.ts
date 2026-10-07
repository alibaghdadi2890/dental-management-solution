import { describe, expect, it } from 'vitest';
import { ACTIVITY_AREAS, areaOfAction, auditEntrySchema, auditQuerySchema } from './audit.js';

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
      patientId: null,
      visitId: null,
      area: 'settings',
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

describe('the activity feed query (feature 7, H7)', () => {
  it('reads its filters from the query string, blank meaning not set', () => {
    const id = '01928c6e-7b8a-7cc2-9d7e-3f1a2b4c5d6e';
    expect(
      auditQuerySchema.parse({
        feed: 'true',
        area: 'payments',
        actorUserId: id,
        platformAdmin: 'false',
        from: '2026-10-01T00:00:00+03:00',
        patientId: '',
        visitId: id,
      }),
    ).toEqual({
      limit: 25,
      feed: true,
      area: 'payments',
      actorUserId: id,
      platformAdmin: false,
      from: '2026-10-01T00:00:00+03:00',
      patientId: undefined,
      visitId: id,
    });
    expect(auditQuerySchema.safeParse({ area: 'weather' }).success).toBe(false);
  });
});

describe('areaOfAction', () => {
  it('files an action under the area of its first segment', () => {
    expect(areaOfAction('patient.merge')).toBe('patients');
    expect(areaOfAction('contact.link')).toBe('contacts');
    expect(areaOfAction('visit_service.create')).toBe('visits');
    expect(areaOfAction('tooth_presence.set')).toBe('visits');
    expect(areaOfAction('ledger_entry.create')).toBe('payments');
    expect(areaOfAction('catalog.service.update')).toBe('catalog');
    expect(areaOfAction('user.roles_assign')).toBe('users');
    expect(areaOfAction('room.update')).toBe('settings');
    expect(ACTIVITY_AREAS).toHaveLength(7);
  });

  it('gives no area to a stored domain event or an action of no area', () => {
    expect(areaOfAction('VisitVoided')).toBeNull();
    expect(areaOfAction('widget.rotate')).toBeNull();
    expect(areaOfAction('.update')).toBeNull();
  });
});
