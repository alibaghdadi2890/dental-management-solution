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
  parseTooth,
  position,
  positionKey,
  predecessorOf,
  presentTooth,
  quadrant,
  slotFor,
  successorOf,
  surfaceCells,
  surfacesSchema,
  toothCodeSchema,
  toothLabel,
  toUniversal,
  validSurfaces,
  type ToothCode,
} from './tooth.js';

/**
 * Every one of the 52 canonical FDI codes, pinned by hand from the mapping formulas in the
 * design spec (never derived by calling the functions under test).
 */
const TOOTH_TABLE: Array<{
  code: ToothCode;
  quadrant: 1 | 2 | 3 | 4;
  position: number;
  isAnterior: boolean;
  isUpper: boolean;
  universal: string;
  primary: boolean;
}> = [
  {
    code: '11',
    quadrant: 1,
    position: 1,
    isAnterior: true,
    isUpper: true,
    universal: '8',
    primary: false,
  },
  {
    code: '12',
    quadrant: 1,
    position: 2,
    isAnterior: true,
    isUpper: true,
    universal: '7',
    primary: false,
  },
  {
    code: '13',
    quadrant: 1,
    position: 3,
    isAnterior: true,
    isUpper: true,
    universal: '6',
    primary: false,
  },
  {
    code: '14',
    quadrant: 1,
    position: 4,
    isAnterior: false,
    isUpper: true,
    universal: '5',
    primary: false,
  },
  {
    code: '15',
    quadrant: 1,
    position: 5,
    isAnterior: false,
    isUpper: true,
    universal: '4',
    primary: false,
  },
  {
    code: '16',
    quadrant: 1,
    position: 6,
    isAnterior: false,
    isUpper: true,
    universal: '3',
    primary: false,
  },
  {
    code: '17',
    quadrant: 1,
    position: 7,
    isAnterior: false,
    isUpper: true,
    universal: '2',
    primary: false,
  },
  {
    code: '18',
    quadrant: 1,
    position: 8,
    isAnterior: false,
    isUpper: true,
    universal: '1',
    primary: false,
  },
  {
    code: '21',
    quadrant: 2,
    position: 1,
    isAnterior: true,
    isUpper: true,
    universal: '9',
    primary: false,
  },
  {
    code: '22',
    quadrant: 2,
    position: 2,
    isAnterior: true,
    isUpper: true,
    universal: '10',
    primary: false,
  },
  {
    code: '23',
    quadrant: 2,
    position: 3,
    isAnterior: true,
    isUpper: true,
    universal: '11',
    primary: false,
  },
  {
    code: '24',
    quadrant: 2,
    position: 4,
    isAnterior: false,
    isUpper: true,
    universal: '12',
    primary: false,
  },
  {
    code: '25',
    quadrant: 2,
    position: 5,
    isAnterior: false,
    isUpper: true,
    universal: '13',
    primary: false,
  },
  {
    code: '26',
    quadrant: 2,
    position: 6,
    isAnterior: false,
    isUpper: true,
    universal: '14',
    primary: false,
  },
  {
    code: '27',
    quadrant: 2,
    position: 7,
    isAnterior: false,
    isUpper: true,
    universal: '15',
    primary: false,
  },
  {
    code: '28',
    quadrant: 2,
    position: 8,
    isAnterior: false,
    isUpper: true,
    universal: '16',
    primary: false,
  },
  {
    code: '31',
    quadrant: 3,
    position: 1,
    isAnterior: true,
    isUpper: false,
    universal: '24',
    primary: false,
  },
  {
    code: '32',
    quadrant: 3,
    position: 2,
    isAnterior: true,
    isUpper: false,
    universal: '23',
    primary: false,
  },
  {
    code: '33',
    quadrant: 3,
    position: 3,
    isAnterior: true,
    isUpper: false,
    universal: '22',
    primary: false,
  },
  {
    code: '34',
    quadrant: 3,
    position: 4,
    isAnterior: false,
    isUpper: false,
    universal: '21',
    primary: false,
  },
  {
    code: '35',
    quadrant: 3,
    position: 5,
    isAnterior: false,
    isUpper: false,
    universal: '20',
    primary: false,
  },
  {
    code: '36',
    quadrant: 3,
    position: 6,
    isAnterior: false,
    isUpper: false,
    universal: '19',
    primary: false,
  },
  {
    code: '37',
    quadrant: 3,
    position: 7,
    isAnterior: false,
    isUpper: false,
    universal: '18',
    primary: false,
  },
  {
    code: '38',
    quadrant: 3,
    position: 8,
    isAnterior: false,
    isUpper: false,
    universal: '17',
    primary: false,
  },
  {
    code: '41',
    quadrant: 4,
    position: 1,
    isAnterior: true,
    isUpper: false,
    universal: '25',
    primary: false,
  },
  {
    code: '42',
    quadrant: 4,
    position: 2,
    isAnterior: true,
    isUpper: false,
    universal: '26',
    primary: false,
  },
  {
    code: '43',
    quadrant: 4,
    position: 3,
    isAnterior: true,
    isUpper: false,
    universal: '27',
    primary: false,
  },
  {
    code: '44',
    quadrant: 4,
    position: 4,
    isAnterior: false,
    isUpper: false,
    universal: '28',
    primary: false,
  },
  {
    code: '45',
    quadrant: 4,
    position: 5,
    isAnterior: false,
    isUpper: false,
    universal: '29',
    primary: false,
  },
  {
    code: '46',
    quadrant: 4,
    position: 6,
    isAnterior: false,
    isUpper: false,
    universal: '30',
    primary: false,
  },
  {
    code: '47',
    quadrant: 4,
    position: 7,
    isAnterior: false,
    isUpper: false,
    universal: '31',
    primary: false,
  },
  {
    code: '48',
    quadrant: 4,
    position: 8,
    isAnterior: false,
    isUpper: false,
    universal: '32',
    primary: false,
  },
  {
    code: '51',
    quadrant: 1,
    position: 1,
    isAnterior: true,
    isUpper: true,
    universal: 'E',
    primary: true,
  },
  {
    code: '52',
    quadrant: 1,
    position: 2,
    isAnterior: true,
    isUpper: true,
    universal: 'D',
    primary: true,
  },
  {
    code: '53',
    quadrant: 1,
    position: 3,
    isAnterior: true,
    isUpper: true,
    universal: 'C',
    primary: true,
  },
  {
    code: '54',
    quadrant: 1,
    position: 4,
    isAnterior: false,
    isUpper: true,
    universal: 'B',
    primary: true,
  },
  {
    code: '55',
    quadrant: 1,
    position: 5,
    isAnterior: false,
    isUpper: true,
    universal: 'A',
    primary: true,
  },
  {
    code: '61',
    quadrant: 2,
    position: 1,
    isAnterior: true,
    isUpper: true,
    universal: 'F',
    primary: true,
  },
  {
    code: '62',
    quadrant: 2,
    position: 2,
    isAnterior: true,
    isUpper: true,
    universal: 'G',
    primary: true,
  },
  {
    code: '63',
    quadrant: 2,
    position: 3,
    isAnterior: true,
    isUpper: true,
    universal: 'H',
    primary: true,
  },
  {
    code: '64',
    quadrant: 2,
    position: 4,
    isAnterior: false,
    isUpper: true,
    universal: 'I',
    primary: true,
  },
  {
    code: '65',
    quadrant: 2,
    position: 5,
    isAnterior: false,
    isUpper: true,
    universal: 'J',
    primary: true,
  },
  {
    code: '71',
    quadrant: 3,
    position: 1,
    isAnterior: true,
    isUpper: false,
    universal: 'O',
    primary: true,
  },
  {
    code: '72',
    quadrant: 3,
    position: 2,
    isAnterior: true,
    isUpper: false,
    universal: 'N',
    primary: true,
  },
  {
    code: '73',
    quadrant: 3,
    position: 3,
    isAnterior: true,
    isUpper: false,
    universal: 'M',
    primary: true,
  },
  {
    code: '74',
    quadrant: 3,
    position: 4,
    isAnterior: false,
    isUpper: false,
    universal: 'L',
    primary: true,
  },
  {
    code: '75',
    quadrant: 3,
    position: 5,
    isAnterior: false,
    isUpper: false,
    universal: 'K',
    primary: true,
  },
  {
    code: '81',
    quadrant: 4,
    position: 1,
    isAnterior: true,
    isUpper: false,
    universal: 'P',
    primary: true,
  },
  {
    code: '82',
    quadrant: 4,
    position: 2,
    isAnterior: true,
    isUpper: false,
    universal: 'Q',
    primary: true,
  },
  {
    code: '83',
    quadrant: 4,
    position: 3,
    isAnterior: true,
    isUpper: false,
    universal: 'R',
    primary: true,
  },
  {
    code: '84',
    quadrant: 4,
    position: 4,
    isAnterior: false,
    isUpper: false,
    universal: 'S',
    primary: true,
  },
  {
    code: '85',
    quadrant: 4,
    position: 5,
    isAnterior: false,
    isUpper: false,
    universal: 'T',
    primary: true,
  },
];

describe('the 52-code table', () => {
  it.each(TOOTH_TABLE)(
    '$code: quadrant/position/isAnterior/isUpper and the universal round trip',
    (row) => {
      expect(quadrant(row.code)).toBe(row.quadrant);
      expect(position(row.code)).toBe(row.position);
      expect(isAnterior(row.code)).toBe(row.isAnterior);
      expect(isUpper(row.code)).toBe(row.isUpper);
      expect(isPrimary(row.code)).toBe(row.primary);
      expect(toUniversal(row.code)).toBe(row.universal);
      expect(parseTooth(row.universal, 'universal')).toBe(row.code);
      expect(parseTooth(`#${row.universal}`, 'universal')).toBe(row.code);
      expect(parseTooth(row.code, 'fdi')).toBe(row.code);
      expect(parseTooth(`#${row.code}`, 'fdi')).toBe(row.code);
    },
  );

  it('covers exactly the 52 codes, no more, no fewer', () => {
    expect(TOOTH_TABLE).toHaveLength(52);
    expect(new Set(TOOTH_TABLE.map((r) => r.code)).size).toBe(52);
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
  const pairs: Array<[ToothCode, ToothCode]> = [
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
  it("lays out patient_right_on_left (textbook) with the patient's right on screen-left", () => {
    const { upper, lower } = archColumns('patient_right_on_left');
    expect(upper).toEqual([
      '18',
      '17',
      '16',
      '15',
      '14',
      '13',
      '12',
      '11',
      '21',
      '22',
      '23',
      '24',
      '25',
      '26',
      '27',
      '28',
    ]);
    expect(lower).toEqual([
      '48',
      '47',
      '46',
      '45',
      '44',
      '43',
      '42',
      '41',
      '31',
      '32',
      '33',
      '34',
      '35',
      '36',
      '37',
      '38',
    ]);
  });

  it('reverses each row for patient_right_on_right', () => {
    const { upper, lower } = archColumns('patient_right_on_right');
    expect(upper).toEqual([
      '28',
      '27',
      '26',
      '25',
      '24',
      '23',
      '22',
      '21',
      '11',
      '12',
      '13',
      '14',
      '15',
      '16',
      '17',
      '18',
    ]);
    expect(lower).toEqual([
      '38',
      '37',
      '36',
      '35',
      '34',
      '33',
      '32',
      '31',
      '41',
      '42',
      '43',
      '44',
      '45',
      '46',
      '47',
      '48',
    ]);
  });
});

describe('keyboardOrder', () => {
  it('is upper row then lower row, 32 unique permanent codes', () => {
    for (const orientation of ['patient_right_on_left', 'patient_right_on_right'] as const) {
      const order = keyboardOrder(orientation);
      const { upper, lower } = archColumns(orientation);
      expect(order).toEqual([...upper, ...lower]);
      expect(order).toHaveLength(32);
      expect(new Set(order).size).toBe(32);
    }
  });
});

describe('surfaceCells', () => {
  it('posterior upper-right, textbook orientation: distal on the left', () => {
    expect(surfaceCells('16', 'patient_right_on_left')).toEqual(['D', 'B', 'M', 'O', 'L']);
  });

  it('anterior upper-left, textbook orientation: mesial on the left, incisal centre', () => {
    expect(surfaceCells('21', 'patient_right_on_left')).toEqual(['M', 'B', 'D', 'I', 'L']);
  });

  it('flips left/right for patient_right_on_right but keeps the centre surface', () => {
    expect(surfaceCells('16', 'patient_right_on_right')).toEqual(['M', 'B', 'D', 'O', 'L']);
    expect(surfaceCells('21', 'patient_right_on_right')).toEqual(['D', 'B', 'M', 'I', 'L']);
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
});

describe('isToothCode', () => {
  it('accepts every one of the 52 canonical codes and rejects others', () => {
    for (const row of TOOTH_TABLE) expect(isToothCode(row.code)).toBe(true);
    expect(isToothCode('99')).toBe(false);
    expect(isToothCode('56')).toBe(false);
    expect(isToothCode('')).toBe(false);
  });

  it('narrows to ToothCode at compile time (see the type-level test below)', () => {
    const value: string = '16';
    if (isToothCode(value)) {
      const narrowed: ToothCode = value;
      expect(narrowed).toBe('16');
    } else {
      throw new Error('expected 16 to be a canonical tooth code');
    }
  });
});

describe('ToothCode (compile time)', () => {
  it('rejects an out-of-range literal at compile time, not just at runtime', () => {
    // @ts-expect-error '99' is not a member of the ToothCode template-literal union.
    quadrant('99');
    // @ts-expect-error '56' is out of range for the primary quadrant (only 81-85, 71-75, ... exist).
    quadrant('56');
  });
});

describe('toothCodeSchema', () => {
  it('accepts every one of the 52 canonical codes', () => {
    for (const row of TOOTH_TABLE) {
      expect(toothCodeSchema.safeParse(row.code).success).toBe(true);
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
});
