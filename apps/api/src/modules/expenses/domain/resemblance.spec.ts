import { describe, expect, it } from 'vitest';
import { resembles } from './resemblance';

describe('a manual expense resembling a supplier payment', () => {
  const supplierRow = { payee: 'DentaLeb', amount: '100.00', spentOn: '2026-11-19' };

  it('matches the payee whatever the case and the spaces', () => {
    expect(
      resembles({ payee: 'dentaleb', amount: '45.00', spentOn: '2026-12-30' }, supplierRow),
    ).toBe(true);
    expect(
      resembles({ payee: 'Denta Leb', amount: '45.00', spentOn: '2026-12-30' }, supplierRow),
    ).toBe(true);
  });

  it('matches the same amount within three days either side', () => {
    expect(resembles({ payee: null, amount: '100', spentOn: '2026-11-22' }, supplierRow)).toBe(
      true,
    );
    expect(resembles({ payee: null, amount: '100.00', spentOn: '2026-11-16' }, supplierRow)).toBe(
      true,
    );
    expect(resembles({ payee: null, amount: '100.00', spentOn: '2026-11-23' }, supplierRow)).toBe(
      false,
    );
  });

  it('leaves another payee and amount alone', () => {
    expect(
      resembles({ payee: 'Pharmacy Rima', amount: '15.00', spentOn: '2026-11-20' }, supplierRow),
    ).toBe(false);
  });
});
