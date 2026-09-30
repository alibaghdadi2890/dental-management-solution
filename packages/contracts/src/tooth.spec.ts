import { describe, expect, it } from 'vitest';
import {
  anatomicalName,
  archColumns,
  effectiveDentition,
  isAnterior,
  isPrimary,
  isToothCode,
  isUpper,
  keyboardOrder,
  mesialLeft,
  parseTooth,
  position,
  positionKey,
  predecessorOf,
  presentTooth,
  quadrant,
  slotFor,
  successionPositionSchema,
  SUCCESSION_POSITIONS,
  successorOf,
  surfaceCells,
  surfacesSchema,
  toothCodeSchema,
  toothLabel,
  toUniversal,
  validSurfaces,
  type PermanentToothCode,
  type PrimaryToothCode,
} from './tooth.js';

/**
 * Every one of the 52 canonical FDI codes, pinned by hand from the mapping formulas in the
 * design spec (never derived by calling the functions under test): code, quadrant, position,
 * isAnterior, isUpper, universal, primary.
 */
const TOOTH_TABLE = [
  ['11', 1, 1, true, true, '8', false],
  ['12', 1, 2, true, true, '7', false],
  ['13', 1, 3, true, true, '6', false],
  ['14', 1, 4, false, true, '5', false],
  ['15', 1, 5, false, true, '4', false],
  ['16', 1, 6, false, true, '3', false],
  ['17', 1, 7, false, true, '2', false],
  ['18', 1, 8, false, true, '1', false],
  ['21', 2, 1, true, true, '9', false],
  ['22', 2, 2, true, true, '10', false],
  ['23', 2, 3, true, true, '11', false],
  ['24', 2, 4, false, true, '12', false],
  ['25', 2, 5, false, true, '13', false],
  ['26', 2, 6, false, true, '14', false],
  ['27', 2, 7, false, true, '15', false],
  ['28', 2, 8, false, true, '16', false],
  ['31', 3, 1, true, false, '24', false],
  ['32', 3, 2, true, false, '23', false],
  ['33', 3, 3, true, false, '22', false],
  ['34', 3, 4, false, false, '21', false],
  ['35', 3, 5, false, false, '20', false],
  ['36', 3, 6, false, false, '19', false],
  ['37', 3, 7, false, false, '18', false],
  ['38', 3, 8, false, false, '17', false],
  ['41', 4, 1, true, false, '25', false],
  ['42', 4, 2, true, false, '26', false],
  ['43', 4, 3, true, false, '27', false],
  ['44', 4, 4, false, false, '28', false],
  ['45', 4, 5, false, false, '29', false],
  ['46', 4, 6, false, false, '30', false],
  ['47', 4, 7, false, false, '31', false],
  ['48', 4, 8, false, false, '32', false],
  ['51', 1, 1, true, true, 'E', true],
  ['52', 1, 2, true, true, 'D', true],
  ['53', 1, 3, true, true, 'C', true],
  ['54', 1, 4, false, true, 'B', true],
  ['55', 1, 5, false, true, 'A', true],
  ['61', 2, 1, true, true, 'F', true],
  ['62', 2, 2, true, true, 'G', true],
  ['63', 2, 3, true, true, 'H', true],
  ['64', 2, 4, false, true, 'I', true],
  ['65', 2, 5, false, true, 'J', true],
  ['71', 3, 1, true, false, 'O', true],
  ['72', 3, 2, true, false, 'N', true],
  ['73', 3, 3, true, false, 'M', true],
  ['74', 3, 4, false, false, 'L', true],
  ['75', 3, 5, false, false, 'K', true],
  ['81', 4, 1, true, false, 'P', true],
  ['82', 4, 2, true, false, 'Q', true],
  ['83', 4, 3, true, false, 'R', true],
  ['84', 4, 4, false, false, 'S', true],
  ['85', 4, 5, false, false, 'T', true],
] as const;

describe('the 52-code table', () => {
  it.each(TOOTH_TABLE)(
    '%s: quadrant/position/isAnterior/isUpper and the universal round trip',
    (
      code,
      expectedQuadrant,
      expectedPosition,
      expectedAnterior,
      expectedUpper,
      universal,
      primary,
    ) => {
      expect(quadrant(code)).toBe(expectedQuadrant);
      expect(position(code)).toBe(expectedPosition);
      expect(isAnterior(code)).toBe(expectedAnterior);
      expect(isUpper(code)).toBe(expectedUpper);
      expect(isPrimary(code)).toBe(primary);
      expect(toUniversal(code)).toBe(universal);
      expect(parseTooth(universal, 'universal')).toBe(code);
      expect(parseTooth(`#${universal}`, 'universal')).toBe(code);
      expect(parseTooth(code, 'fdi')).toBe(code);
      expect(parseTooth(`#${code}`, 'fdi')).toBe(code);
      expect(isToothCode(code)).toBe(true);
    },
  );

  it('covers exactly the 52 codes, no more, no fewer', () => {
    expect(TOOTH_TABLE).toHaveLength(52);
    expect(new Set(TOOTH_TABLE.map((row) => row[0])).size).toBe(52);
  });
});

describe('toothLabel', () => {
  it('formats FDI with a leading #', () => {
    expect(toothLabel('16', 'fdi')).toBe('#16');
    expect(toothLabel('55', 'fdi')).toBe('#55');
  });

  it('formats Universal permanent with a leading # but primary letters bare', () => {
    expect(toothLabel('16', 'universal')).toBe('#3');
    expect(toothLabel('55', 'universal')).toBe('A');
  });
});

describe('successorOf / predecessorOf', () => {
  const pairs: ReadonlyArray<readonly [PrimaryToothCode, PermanentToothCode]> = [
    ['51', '11'],
    ['52', '12'],
    ['53', '13'],
    ['54', '14'],
    ['55', '15'],
    ['61', '21'],
    ['62', '22'],
    ['63', '23'],
    ['64', '24'],
    ['65', '25'],
    ['71', '31'],
    ['72', '32'],
    ['73', '33'],
    ['74', '34'],
    ['75', '35'],
    ['81', '41'],
    ['82', '42'],
    ['83', '43'],
    ['84', '44'],
    ['85', '45'],
  ];

  it.each(pairs)('successorOf(%s) === %s', (primaryCode, permanentCode) => {
    expect(successorOf(primaryCode)).toBe(permanentCode);
  });

  it.each(pairs)('predecessorOf(%s) === %s', (primaryCode, permanentCode) => {
    expect(predecessorOf(permanentCode)).toBe(primaryCode);
  });

  it('is null for a permanent tooth with no primary predecessor (molars)', () => {
    expect(predecessorOf('16')).toBeNull();
    expect(predecessorOf('17')).toBeNull();
    expect(predecessorOf('18')).toBeNull();
  });
});

describe('positionKey', () => {
  it('maps a primary code to its successor and leaves a permanent code alone', () => {
    expect(positionKey('54')).toBe('14');
    expect(positionKey('14')).toBe('14');
  });
});

describe('archColumns', () => {
  it("patient_right_on_left (textbook): patient's right on screen-left", () => {
    const { upper, lower } = archColumns('patient_right_on_left');
    expect(upper).toEqual('18 17 16 15 14 13 12 11 21 22 23 24 25 26 27 28'.split(' '));
    expect(lower).toEqual('48 47 46 45 44 43 42 41 31 32 33 34 35 36 37 38'.split(' '));
  });

  it('patient_right_on_right: each row reversed', () => {
    const { upper, lower } = archColumns('patient_right_on_right');
    expect(upper).toEqual('28 27 26 25 24 23 22 21 11 12 13 14 15 16 17 18'.split(' '));
    expect(lower).toEqual('38 37 36 35 34 33 32 31 41 42 43 44 45 46 47 48'.split(' '));
  });
});

describe('keyboardOrder', () => {
  it("is upper row then lower row, 32 unique codes; wrapping past either end is the caller's job", () => {
    const order = keyboardOrder('patient_right_on_left');
    expect(order).toHaveLength(32);
    expect(new Set(order).size).toBe(32);
    expect(order[0]).toBe('18');
    expect(order[15]).toBe('28');
    expect(order[16]).toBe('48');
    expect(order[31]).toBe('38');
  });
});

describe('mesialLeft', () => {
  it.each([
    ['16', 'patient_right_on_left', false],
    ['16', 'patient_right_on_right', true],
    ['26', 'patient_right_on_left', true],
    ['26', 'patient_right_on_right', false],
    ['36', 'patient_right_on_left', true],
    ['36', 'patient_right_on_right', false],
    ['46', 'patient_right_on_left', false],
    ['46', 'patient_right_on_right', true],
  ] as const)('%s, %s -> %s', (code, orientation, expected) => {
    expect(mesialLeft(code, orientation)).toBe(expected);
  });
});

describe('surfaceCells', () => {
  it.each([
    ['16', 'patient_right_on_left', ['D', 'B', 'M', 'O', 'L']],
    ['16', 'patient_right_on_right', ['M', 'B', 'D', 'O', 'L']],
    ['26', 'patient_right_on_left', ['M', 'B', 'D', 'O', 'L']],
    ['26', 'patient_right_on_right', ['D', 'B', 'M', 'O', 'L']],
    ['36', 'patient_right_on_left', ['M', 'B', 'D', 'O', 'L']],
    ['36', 'patient_right_on_right', ['D', 'B', 'M', 'O', 'L']],
    ['46', 'patient_right_on_left', ['D', 'B', 'M', 'O', 'L']],
    ['46', 'patient_right_on_right', ['M', 'B', 'D', 'O', 'L']],
    ['21', 'patient_right_on_left', ['M', 'B', 'D', 'I', 'L']],
    ['21', 'patient_right_on_right', ['D', 'B', 'M', 'I', 'L']],
    ['31', 'patient_right_on_left', ['M', 'B', 'D', 'I', 'L']],
    ['31', 'patient_right_on_right', ['D', 'B', 'M', 'I', 'L']],
  ] as const)('%s, %s -> %s', (code, orientation, expected) => {
    expect(surfaceCells(code, orientation)).toEqual(expected);
  });
});

describe('validSurfaces', () => {
  it('rejects O on an anterior tooth and I on a posterior tooth', () => {
    expect(validSurfaces('11', ['O'])).toBe(false);
    expect(validSurfaces('16', ['I'])).toBe(false);
  });

  it('accepts the matching centre surface and the shared surfaces', () => {
    expect(validSurfaces('11', ['I', 'M', 'D', 'B', 'L'])).toBe(true);
    expect(validSurfaces('16', ['O', 'M', 'D', 'B', 'L'])).toBe(true);
  });

  it('draws the line between the canine (anterior) and the first premolar (posterior)', () => {
    expect(validSurfaces('13', ['I'])).toBe(true);
    expect(validSurfaces('13', ['O'])).toBe(false);
    expect(validSurfaces('14', ['O'])).toBe(true);
    expect(validSurfaces('14', ['I'])).toBe(false);
  });
});

describe('anatomicalName', () => {
  it('returns i18n keys and params, never English text, for permanent teeth', () => {
    expect(anatomicalName('11')).toEqual({
      key: 'tooth.name',
      params: { quadrant: 'upperRight', tooth: 'centralIncisor' },
    });
    expect(anatomicalName('48')).toEqual({
      key: 'tooth.name',
      params: { quadrant: 'lowerRight', tooth: 'thirdMolar' },
    });
  });

  it('uses primary names, where positions 4-5 are first/second molar', () => {
    expect(anatomicalName('54')).toEqual({
      key: 'tooth.primaryName',
      params: { quadrant: 'upperRight', tooth: 'firstMolar' },
    });
    expect(anatomicalName('75')).toEqual({
      key: 'tooth.primaryName',
      params: { quadrant: 'lowerLeft', tooth: 'secondMolar' },
    });
  });
});

describe('slotFor', () => {
  it('permanent stage: every position is permanent', () => {
    for (let p = 1; p <= 8; p++) expect(slotFor('permanent', p)).toBe('permanent');
  });

  it('primary stage: 1-5 primary, 6-8 not erupted', () => {
    for (let p = 1; p <= 5; p++) expect(slotFor('primary', p)).toBe('primary');
    for (let p = 6; p <= 8; p++) expect(slotFor('primary', p)).toBe('not_erupted');
  });

  it('mixed stage: 1-2 permanent, 3-5 primary, 6 permanent, 7-8 not erupted', () => {
    expect(slotFor('mixed', 1)).toBe('permanent');
    expect(slotFor('mixed', 2)).toBe('permanent');
    expect(slotFor('mixed', 3)).toBe('primary');
    expect(slotFor('mixed', 4)).toBe('primary');
    expect(slotFor('mixed', 5)).toBe('primary');
    expect(slotFor('mixed', 6)).toBe('permanent');
    expect(slotFor('mixed', 7)).toBe('not_erupted');
    expect(slotFor('mixed', 8)).toBe('not_erupted');
  });
});

describe('effectiveDentition', () => {
  it('falls back to permanent/auto with no age and no override', () => {
    expect(effectiveDentition(null, null)).toEqual({ stage: 'permanent', source: 'auto' });
  });

  it('derives the stage from age when there is no override', () => {
    expect(effectiveDentition(4, null)).toEqual({ stage: 'primary', source: 'auto' });
    expect(effectiveDentition(8, null)).toEqual({ stage: 'mixed', source: 'auto' });
    expect(effectiveDentition(20, null)).toEqual({ stage: 'permanent', source: 'auto' });
  });

  it('an override always wins, even against a contradicting age', () => {
    expect(effectiveDentition(8, 'permanent')).toEqual({ stage: 'permanent', source: 'override' });
    expect(effectiveDentition(null, 'primary')).toEqual({ stage: 'primary', source: 'override' });
  });
});

describe('presentTooth', () => {
  it('resolves the primary tooth for a mixed-stage column in the primary band', () => {
    expect(presentTooth('14', 'mixed')).toEqual({ code: '54', notErupted: false });
  });

  it('an explicit presence override wins over the slot', () => {
    expect(presentTooth('14', 'mixed', 'permanent')).toEqual({ code: '14', notErupted: false });
  });

  it('reports not-erupted for a not-yet-through permanent molar', () => {
    expect(presentTooth('17', 'mixed')).toEqual({ code: '17', notErupted: true });
  });

  it('resolves straight through for the permanent stage', () => {
    expect(presentTooth('11', 'permanent')).toEqual({ code: '11', notErupted: false });
  });

  it('resolves the primary tooth for the primary stage', () => {
    expect(presentTooth('44', 'primary')).toEqual({ code: '84', notErupted: false });
  });

  it('a presence override beyond position 5 has no effect (molars have no primary slot)', () => {
    expect(presentTooth('16', 'permanent', 'primary')).toEqual({ code: '16', notErupted: false });
  });

  it('a presence override still applies within positions 1-5 in the permanent stage', () => {
    expect(presentTooth('14', 'permanent', 'primary')).toEqual({ code: '54', notErupted: false });
  });
});

describe('toothCodeSchema', () => {
  it('accepts every one of the 52 canonical codes', () => {
    for (const row of TOOTH_TABLE) {
      expect(toothCodeSchema.safeParse(row[0]).success).toBe(true);
    }
  });

  it('rejects codes outside the canonical set', () => {
    expect(toothCodeSchema.safeParse('19').success).toBe(false);
    expect(toothCodeSchema.safeParse('56').success).toBe(false);
    expect(toothCodeSchema.safeParse('09').success).toBe(false);
    expect(toothCodeSchema.safeParse('00').success).toBe(false);
    expect(toothCodeSchema.safeParse('').success).toBe(false);
  });
});

describe('SUCCESSION_POSITIONS / successionPositionSchema', () => {
  it('is exactly the 20 permanent codes at positions 1–5', () => {
    expect(SUCCESSION_POSITIONS).toHaveLength(20);
    expect(SUCCESSION_POSITIONS.every((code) => position(code) <= 5)).toBe(true);
    expect(SUCCESSION_POSITIONS).toContain('14');
    expect(SUCCESSION_POSITIONS).not.toContain('16');
  });

  it('rejects a position beyond 5 and a primary code', () => {
    expect(successionPositionSchema.safeParse('14').success).toBe(true);
    expect(successionPositionSchema.safeParse('16').success).toBe(false);
    expect(successionPositionSchema.safeParse('54').success).toBe(false);
  });
});

describe('isToothCode', () => {
  it('accepts every one of the 52 canonical codes and rejects others', () => {
    for (const row of TOOTH_TABLE) expect(isToothCode(row[0])).toBe(true);
    expect(isToothCode('99')).toBe(false);
    expect(isToothCode('56')).toBe(false);
    expect(isToothCode('')).toBe(false);
  });
});

describe('surfacesSchema', () => {
  it('accepts a valid surface set', () => {
    expect(surfacesSchema.safeParse(['M', 'D', 'B']).success).toBe(true);
  });

  it('rejects duplicates', () => {
    expect(surfacesSchema.safeParse(['M', 'M']).success).toBe(false);
  });

  it('rejects more than 5 surfaces', () => {
    expect(surfacesSchema.safeParse(['M', 'D', 'B', 'L', 'O', 'I']).success).toBe(false);
  });

  it('rejects an unknown surface key', () => {
    expect(surfacesSchema.safeParse(['X']).success).toBe(false);
  });
});

describe('parseTooth', () => {
  it('returns null for garbage input', () => {
    expect(parseTooth('', 'fdi')).toBeNull();
    expect(parseTooth('zz', 'fdi')).toBeNull();
    expect(parseTooth('99', 'universal')).toBeNull();
    expect(parseTooth('AB', 'universal')).toBeNull();
  });

  it('accepts a lower-case primary universal letter', () => {
    expect(parseTooth('a', 'universal')).toBe('55');
  });

  it('rejects out-of-range and non-tooth universal input', () => {
    expect(parseTooth('0', 'universal')).toBeNull();
    expect(parseTooth('33', 'universal')).toBeNull();
    expect(parseTooth('U', 'universal')).toBeNull();
    expect(parseTooth('#', 'universal')).toBeNull();
  });
});

/**
 * Type-level only, never executed: pins `ToothCode` as a closed template-literal union rather
 * than `string`. If it ever widens back to `string`, these `@ts-expect-error` lines stop
 * erroring and `tsc` fails the build.
 */
function _toothCodeIsNotJustAString(): void {
  // @ts-expect-error '99': the first digit is out of range (quadrants only go 1-4, 5-8).
  quadrant('99');
  // @ts-expect-error '56': the second digit is out of range for a primary quadrant (only 1-5).
  quadrant('56');
}
