import { describe, expect, it } from 'vitest';
import type { DomainPatient } from './patient';
import { resolveMerge } from './merge';

function patient(overrides: Partial<DomainPatient> = {}): DomainPatient {
  return {
    id: 'kept-id',
    displayNumber: 'P-000001',
    fullName: 'Kept Name',
    nameKey: 'kept name',
    phone: '+96100000001',
    phoneSearch: '96100000001 00000001',
    dateOfBirth: '2000-01-01',
    sex: 'female',
    email: 'kept@example.com',
    address: 'Kept Addr',
    insurance: 'Kept Ins',
    emergencyContact: 'Kept EC',
    notes: 'Kept notes',
    medicalAlerts: ['Penicillin'],
    primaryDentistUserId: 'dentist-1',
    guardianName: null,
    guardianPhone: null,
    externalId: null,
    mergedIntoId: null,
    deletedAt: null,
    createdAt: new Date('2024-01-01T00:00:00Z'),
    updatedAt: new Date('2024-01-02T00:00:00Z'),
    ...overrides,
  };
}

const dropped = patient({
  id: 'dropped-id',
  displayNumber: 'P-000002',
  fullName: 'Dropped Name',
  nameKey: 'dropped name',
  phone: '+96100000002',
  phoneSearch: '96100000002 00000002',
  dateOfBirth: '1999-05-05',
  sex: 'male',
  email: 'dropped@example.com',
  address: 'Dropped Addr',
  insurance: 'Dropped Ins',
  emergencyContact: 'Dropped EC',
  notes: 'Dropped notes',
  medicalAlerts: ['penicillin', 'Latex'],
  primaryDentistUserId: 'dentist-2',
  guardianName: 'Guardian G',
  guardianPhone: '+96100000003',
});

describe('resolveMerge', () => {
  it('keeps every field by default, still unioning the alerts', () => {
    const kept = patient();
    const { patch, changedFields } = resolveMerge(kept, dropped, {});
    expect(changedFields).toEqual([]);
    expect(patch).toEqual({ medicalAlerts: ['Penicillin', 'Latex'] });
  });

  it('takes a field from the dropped record when chosen, and records it as changed', () => {
    const kept = patient();
    const { patch, changedFields } = resolveMerge(kept, dropped, { fullName: 'drop' });
    expect(patch.fullName).toBe('Dropped Name');
    expect(changedFields).toEqual(['fullName']);
  });

  it('resolves every scalar field independently', () => {
    const kept = patient();
    const { patch, changedFields } = resolveMerge(kept, dropped, {
      phone: 'drop',
      dateOfBirth: 'drop',
      sex: 'drop',
      email: 'drop',
      address: 'drop',
      insurance: 'drop',
      emergencyContact: 'drop',
      primaryDentistUserId: 'drop',
      notes: 'drop',
    });
    expect(patch).toMatchObject({
      phone: '+96100000002',
      dateOfBirth: '1999-05-05',
      sex: 'male',
      email: 'dropped@example.com',
      address: 'Dropped Addr',
      insurance: 'Dropped Ins',
      emergencyContact: 'Dropped EC',
      primaryDentistUserId: 'dentist-2',
      notes: 'Dropped notes',
    });
    expect(changedFields).toEqual(
      expect.arrayContaining([
        'phone',
        'dateOfBirth',
        'sex',
        'email',
        'address',
        'insurance',
        'emergencyContact',
        'primaryDentistUserId',
        'notes',
      ]),
    );
  });

  it('moves guardianName and guardianPhone together under the single "guardian" choice', () => {
    const kept = patient();
    const { patch, changedFields } = resolveMerge(kept, dropped, { guardian: 'drop' });
    expect(patch).toMatchObject({ guardianName: 'Guardian G', guardianPhone: '+96100000003' });
    expect(changedFields).toEqual(['guardian']);
  });

  it('does not report guardian as changed when both sides already agree', () => {
    const kept = patient({ guardianName: 'Same', guardianPhone: '+96100000009' });
    const droppedSameGuardian = patient({
      id: 'dropped-id',
      guardianName: 'Same',
      guardianPhone: '+96100000009',
      medicalAlerts: kept.medicalAlerts,
    });
    const { patch, changedFields } = resolveMerge(kept, droppedSameGuardian, { guardian: 'drop' });
    expect(patch.guardianName).toBeUndefined();
    expect(patch.guardianPhone).toBeUndefined();
    expect(changedFields).toEqual([]);
  });

  it('unions medical alerts case-insensitively, kept first then dropped, never as a choice', () => {
    const kept = patient({ medicalAlerts: ['Penicillin', 'Latex'] });
    const droppedAlerts = patient({
      id: 'dropped-id',
      medicalAlerts: ['LATEX', 'Nut allergy', 'penicillin'],
    });
    const { patch } = resolveMerge(kept, droppedAlerts, {});
    expect(patch.medicalAlerts).toEqual(['Penicillin', 'Latex', 'Nut allergy']);
  });

  it('caps the unioned alerts at 20, kept alerts taking priority', () => {
    const keptAlerts = Array.from({ length: 12 }, (_, i) => `Kept-${i}`);
    const droppedAlertsList = Array.from({ length: 12 }, (_, i) => `Dropped-${i}`);
    const kept = patient({ medicalAlerts: keptAlerts });
    const droppedAlerts = patient({ id: 'dropped-id', medicalAlerts: droppedAlertsList });
    const { patch } = resolveMerge(kept, droppedAlerts, {});
    expect(patch.medicalAlerts).toHaveLength(20);
    expect(patch.medicalAlerts).toEqual([...keptAlerts, ...droppedAlertsList.slice(0, 8)]);
  });

  it('omits medicalAlerts from the patch when the union equals the kept alerts', () => {
    const kept = patient({ medicalAlerts: ['Penicillin'] });
    const droppedSameAlerts = patient({ id: 'dropped-id', medicalAlerts: ['penicillin'] });
    const { patch } = resolveMerge(kept, droppedSameAlerts, {});
    expect(patch.medicalAlerts).toBeUndefined();
  });
});
