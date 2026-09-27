import { describe, expect, it } from 'vitest';
import { groupDuplicates, type DuplicateCandidate } from './duplicates';

function row(
  overrides: Partial<DuplicateCandidate> & { displayNumber: string },
): DuplicateCandidate {
  return { nameKey: 'jane doe', dateOfBirth: '2000-01-01', ...overrides };
}

describe('groupDuplicates', () => {
  it('groups rows sharing a name key and date of birth', () => {
    const a = row({ displayNumber: 'P-000001' });
    const b = row({ displayNumber: 'P-000002' });
    expect(groupDuplicates([a, b])).toEqual([[a, b]]);
  });

  it('skips rows with no date of birth', () => {
    const a = row({ displayNumber: 'P-000001', dateOfBirth: null });
    const b = row({ displayNumber: 'P-000002', dateOfBirth: null });
    expect(groupDuplicates([a, b])).toEqual([]);
  });

  it('drops groups of a single row', () => {
    const a = row({ displayNumber: 'P-000001' });
    const other = row({ displayNumber: 'P-000002', nameKey: 'john smith' });
    expect(groupDuplicates([a, other])).toEqual([]);
  });

  it('keeps distinct name+dob pairs as separate groups', () => {
    const a = row({ displayNumber: 'P-000001', nameKey: 'jane doe' });
    const b = row({ displayNumber: 'P-000002', nameKey: 'jane doe' });
    const c = row({ displayNumber: 'P-000003', nameKey: 'jane doe', dateOfBirth: '2001-01-01' });
    const d = row({ displayNumber: 'P-000004', nameKey: 'jane doe', dateOfBirth: '2001-01-01' });
    expect(groupDuplicates([a, b, c, d])).toEqual([
      [a, b],
      [c, d],
    ]);
  });

  it('orders each group by display number in numeric, not lexical, order', () => {
    const p9 = row({ displayNumber: 'P-000009' });
    const p10 = row({ displayNumber: 'P-000010' });
    const p1 = row({ displayNumber: 'P-000001' });
    expect(groupDuplicates([p10, p1, p9])).toEqual([[p1, p9, p10]]);
  });
});
