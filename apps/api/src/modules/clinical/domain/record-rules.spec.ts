import { describe, expect, it } from 'vitest';
import { ValidationFailedError } from '../../../platform/kernel/validation-failed.error';
import {
  assertCurrency,
  assertLinePrice,
  assertTarget,
  isRemovableOutsideVisit,
} from './record-rules';
import {
  CurrencyMismatchError,
  JawNotAllowedError,
  JawRequiredError,
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

  it('accepts a per-jaw item on a jaw, and a whole-mouth item with no target', () => {
    expect(() => {
      assertTarget('per_jaw', null, [], 'upper');
    }).not.toThrow();
    expect(() => {
      assertTarget('per_jaw', undefined, [], 'lower');
    }).not.toThrow();
    expect(() => {
      assertTarget('per_mouth', null, []);
    }).not.toThrow();
    expect(() => {
      assertTarget('per_mouth', undefined, [], null);
    }).not.toThrow();
  });

  it('422 visit.jaw_required: a per-jaw item without its jaw', () => {
    expect(() => {
      assertTarget('per_jaw', null, []);
    }).toThrow(JawRequiredError);
  });

  it('422 visit.jaw_not_allowed: a jaw on a per-tooth or whole-mouth item', () => {
    expect(() => {
      assertTarget('per_tooth', '16', [], 'upper');
    }).toThrow(JawNotAllowedError);
    expect(() => {
      assertTarget('per_mouth', null, [], 'lower');
    }).toThrow(JawNotAllowedError);
  });

  it('422 visit.tooth_required: a per-tooth item without a tooth', () => {
    expect(() => {
      assertTarget('per_tooth', null, []);
    }).toThrow(ToothRequiredError);
    expect(() => {
      assertTarget('per_tooth', undefined, ['O']);
    }).toThrow(ToothRequiredError);
  });

  it('422 visit.tooth_not_allowed: a per-jaw or whole-mouth item on a tooth', () => {
    expect(() => {
      assertTarget('per_jaw', '16', [], 'upper');
    }).toThrow(ToothNotAllowedError);
    expect(() => {
      assertTarget('per_mouth', '16', []);
    }).toThrow(ToothNotAllowedError);
  });

  it('422 visit.surfaces_invalid: surfaces on a per-jaw or whole-mouth item', () => {
    expect(() => {
      assertTarget('per_jaw', null, ['O'], 'upper');
    }).toThrow(SurfacesInvalidError);
    expect(() => {
      assertTarget('per_mouth', null, ['O']);
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

describe('isRemovableOutsideVisit', () => {
  it('is true only for a record made without a visit', () => {
    expect(isRemovableOutsideVisit({ recordedInVisitId: null })).toBe(true);
    expect(isRemovableOutsideVisit({ recordedInVisitId: 'visit-1' })).toBe(false);
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

describe('assertLinePrice', () => {
  it('accepts a discount up to the base', () => {
    expect(() => {
      assertLinePrice({ baseAmount: '60.00', discountAmount: '60' }, 'discountAmount');
    }).not.toThrow();
    expect(() => {
      assertLinePrice({ baseAmount: '0', discountAmount: '0.00' }, 'baseAmount');
    }).not.toThrow();
  });

  it('reports a discount above the base at the field that changed', () => {
    const at = (changed: 'baseAmount' | 'discountAmount') => {
      try {
        assertLinePrice({ baseAmount: '10.00', discountAmount: '10.01' }, changed);
      } catch (error) {
        expect(error).toBeInstanceOf(ValidationFailedError);
        return (error as ValidationFailedError).issues.map((issue) => issue.path);
      }
      throw new Error('expected a ValidationFailedError');
    };
    expect(at('discountAmount')).toEqual(['discountAmount']);
    expect(at('baseAmount')).toEqual(['baseAmount']);
  });
});
