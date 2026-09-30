import { describe, expect, it } from 'vitest';
import { assertCurrency, assertTarget } from './record-rules';
import {
  CurrencyMismatchError,
  SurfacesInvalidError,
  ToothNotAllowedError,
  ToothRequiredError,
} from './visit-errors';

describe('assertTarget', () => {
  it('accepts a per-tooth item on a tooth, with or without valid surfaces', () => {
    expect(() => {
      assertTarget('per_tooth', '16', []);
    }).not.toThrow();
    expect(() => {
      assertTarget('per_tooth', '16', ['M', 'O']);
    }).not.toThrow();
    expect(() => {
      assertTarget('per_tooth', '11', ['I', 'L']);
    }).not.toThrow();
    expect(() => {
      assertTarget('per_tooth', '55', ['D', 'O']);
    }).not.toThrow();
  });

  it('accepts a per-jaw item with no tooth and no surfaces', () => {
    expect(() => {
      assertTarget('per_jaw', null, []);
    }).not.toThrow();
    expect(() => {
      assertTarget('per_jaw', undefined, []);
    }).not.toThrow();
  });

  it('422 visit.tooth_required: a per-tooth item without a tooth', () => {
    expect(() => {
      assertTarget('per_tooth', null, []);
    }).toThrow(ToothRequiredError);
    expect(() => {
      assertTarget('per_tooth', undefined, ['O']);
    }).toThrow(ToothRequiredError);
  });

  it('422 visit.tooth_not_allowed: a per-jaw item on a tooth', () => {
    expect(() => {
      assertTarget('per_jaw', '16', []);
    }).toThrow(ToothNotAllowedError);
  });

  it('422 visit.surfaces_invalid: surfaces on a per-jaw item', () => {
    expect(() => {
      assertTarget('per_jaw', null, ['O']);
    }).toThrow(SurfacesInvalidError);
  });

  it('422 visit.surfaces_invalid: a surface the tooth does not have', () => {
    expect(() => {
      assertTarget('per_tooth', '11', ['O']);
    }).toThrow(SurfacesInvalidError);
    expect(() => {
      assertTarget('per_tooth', '16', ['I']);
    }).toThrow(SurfacesInvalidError);
  });
});

describe('assertCurrency', () => {
  it('accepts a price in the visit currency', () => {
    expect(() => {
      assertCurrency('USD', 'USD');
    }).not.toThrow();
  });

  it('422 visit.currency_mismatch: a price in another currency', () => {
    expect(() => {
      assertCurrency('USD', 'LBP');
    }).toThrow(CurrencyMismatchError);
  });
});
