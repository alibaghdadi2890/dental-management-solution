import { describe, expect, it } from 'vitest';
import { assertAssignments, assertKeepsAnOwner, assertNotSelf } from './staff-rules';

describe('assertKeepsAnOwner', () => {
  it('refuses to take away the only active owner', () => {
    expect(() => {
      assertKeepsAnOwner(['owner-1'], 'owner-1');
    }).toThrow(expect.objectContaining({ code: 'user.last_owner', kind: 'conflict' }));
  });

  it('allows it while another active owner remains', () => {
    expect(() => {
      assertKeepsAnOwner(['owner-1', 'owner-2'], 'owner-1');
    }).not.toThrow();
  });

  it('ignores users who are not active owners', () => {
    expect(() => {
      assertKeepsAnOwner(['owner-1'], 'dentist-1');
    }).not.toThrow();
  });
});

describe('assertNotSelf', () => {
  it('refuses to deactivate yourself', () => {
    expect(() => {
      assertNotSelf('user-1', 'user-1');
    }).toThrow(expect.objectContaining({ code: 'user.self_deactivation', kind: 'conflict' }));
  });

  it('allows acting on someone else, or without a user (system)', () => {
    expect(() => {
      assertNotSelf('user-1', 'user-2');
    }).not.toThrow();
    expect(() => {
      assertNotSelf(undefined, 'user-2');
    }).not.toThrow();
  });
});

describe('assertAssignments', () => {
  it('requires at least one role and one branch', () => {
    expect(() => {
      assertAssignments({ roleKeys: [], branchIds: ['b'] });
    }).toThrow(expect.objectContaining({ code: 'user.role_required', kind: 'invalid' }));
    expect(() => {
      assertAssignments({ roleKeys: ['owner'], branchIds: [] });
    }).toThrow(expect.objectContaining({ code: 'user.branch_required', kind: 'invalid' }));
  });

  it('only checks what the change touches', () => {
    expect(() => {
      assertAssignments({});
    }).not.toThrow();
    expect(() => {
      assertAssignments({ roleKeys: ['frontdesk'], branchIds: ['b'] });
    }).not.toThrow();
  });
});
