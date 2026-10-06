/**
 * The canonical tooth model for charting (feature 4a). Pure — no I/O, no Nest, no Drizzle — so it
 * runs unmodified in the API, the SPA and the agent tools (CLAUDE.md §4, §11).
 *
 * The canonical stored value is FDI two-digit text (`ToothCode`). Universal notation, labels and
 * orientation-aware layout are all derived from it; nothing else is stored. Positions are counted
 * outward from the midline (1 central incisor … 8 third molar; primary only goes to 5), which is
 * what lets a primary tooth and its permanent successor share one chart column (`positionKey`).
 */

import { z } from 'zod';
import { dentitionStage, type DentitionStage } from './patient-age.js';

// Tenant-facing chart preferences (also used by tenant settings and visit contracts, later tasks).

export const TOOTH_NOTATIONS = ['fdi', 'universal'] as const;
export type ToothNotation = (typeof TOOTH_NOTATIONS)[number];
export const toothNotationSchema = z.enum(TOOTH_NOTATIONS);

export const CHART_ORIENTATIONS = ['patient_right_on_right', 'patient_right_on_left'] as const;
export type ChartOrientation = (typeof CHART_ORIENTATIONS)[number];
export const chartOrientationSchema = z.enum(CHART_ORIENTATIONS);

export const CHART_MODES = ['surface', 'simple'] as const;
export type ChartMode = (typeof CHART_MODES)[number];
export const chartModeSchema = z.enum(CHART_MODES);

export const SURFACES = ['M', 'D', 'B', 'L', 'O', 'I'] as const;
export type SurfaceKey = (typeof SURFACES)[number];
export const surfaceKeySchema = z.enum(SURFACES);

/** A surface set for one tooth: no duplicates, at most the 5 surfaces one tooth has (M, D, B, L,
 * and one of O/I — see `surfaceCells`). */
export const surfacesSchema = z
  .array(surfaceKeySchema)
  .max(5)
  .refine((surfaces) => new Set(surfaces).size === surfaces.length, {
    message: 'Duplicate surface',
  });

// Canonical codes.

/** A permanent FDI code: quadrant 1–4, position 1–8 (e.g. `'16'`). */
export type PermanentToothCode = `${1 | 2 | 3 | 4}${1 | 2 | 3 | 4 | 5 | 6 | 7 | 8}`;
/** A primary (deciduous) FDI code: quadrant 5–8, position 1–5 (e.g. `'55'`). */
export type PrimaryToothCode = `${5 | 6 | 7 | 8}${1 | 2 | 3 | 4 | 5}`;
/** The canonical stored value: FDI two-digit text, exactly the 52 codes `PERMANENT_CODES`/
 * `PRIMARY_CODES` enumerate. */
export type ToothCode = PermanentToothCode | PrimaryToothCode;

/** 11–18, 21–28, 31–38, 41–48, quadrant-major and position-ascending. */
export const PERMANENT_CODES: readonly PermanentToothCode[] = [
  '11',
  '12',
  '13',
  '14',
  '15',
  '16',
  '17',
  '18',
  '21',
  '22',
  '23',
  '24',
  '25',
  '26',
  '27',
  '28',
  '31',
  '32',
  '33',
  '34',
  '35',
  '36',
  '37',
  '38',
  '41',
  '42',
  '43',
  '44',
  '45',
  '46',
  '47',
  '48',
];
/** 51–55, 61–65, 71–75, 81–85. */
export const PRIMARY_CODES: readonly PrimaryToothCode[] = [
  '51',
  '52',
  '53',
  '54',
  '55',
  '61',
  '62',
  '63',
  '64',
  '65',
  '71',
  '72',
  '73',
  '74',
  '75',
  '81',
  '82',
  '83',
  '84',
  '85',
];

const ALL_CODES: ReadonlySet<string> = new Set<string>([...PERMANENT_CODES, ...PRIMARY_CODES]);

/** Runtime check + compile-time narrowing for `ToothCode`; use at persistence boundaries. */
export function isToothCode(value: string): value is ToothCode {
  return ALL_CODES.has(value);
}

/** Exactly the 52 canonical FDI codes, as a `z.enum` (not `.refine`) so OpenAPI and agent tool
 * schemas keep the 52 values instead of widening to `string`. */
export const toothCodeSchema = z.enum([...PERMANENT_CODES, ...PRIMARY_CODES]);

// Core facts about a code.

/** 1 upper-right, 2 upper-left, 3 lower-left, 4 lower-right. Primary quadrants 5–8 map onto the
 * same 1–4 (first-digit mod 4), which is what lets a primary tooth and its permanent successor
 * share one chart column. */
export function quadrant(code: ToothCode): 1 | 2 | 3 | 4 {
  const first = Number(code[0]);
  return (((first - 1) % 4) + 1) as 1 | 2 | 3 | 4;
}

/** Second digit: 1 (central incisor, midline) … 8 (third molar); primary only goes to 5. */
export function position(code: ToothCode): number {
  return Number(code[1]);
}

/** The 20 permanent codes at positions 1–5 — the only chart columns with a primary predecessor,
 * i.e. the valid targets of `PUT /visits/:id/teeth/:position` (`setToothPresence`, spec W5/W15). */
export const SUCCESSION_POSITIONS: readonly PermanentToothCode[] = PERMANENT_CODES.filter(
  (code) => position(code) <= 5,
);

/** `SUCCESSION_POSITIONS` as a `z.enum`, for the path param schema. */
export const successionPositionSchema = z.enum(
  SUCCESSION_POSITIONS as [PermanentToothCode, ...PermanentToothCode[]],
);

/** A code is primary iff its first digit is 5–8. */
export function isPrimary(code: ToothCode): code is PrimaryToothCode {
  return Number(code[0]) >= 5;
}

export function isUpper(code: ToothCode): boolean {
  const q = quadrant(code);
  return q === 1 || q === 2;
}

export function isAnterior(code: ToothCode): boolean {
  return position(code) <= 3;
}

function universalLetter(base: string, offsetFromBase: number): string {
  return String.fromCharCode(base.charCodeAt(0) + offsetFromBase);
}

/**
 * Universal/National notation: permanent `1–32`, primary `A–T`.
 * Permanent: UR `9−p`, UL `8+p`, LL `25−p`, LR `24+p`.
 * Primary: UR `'A'+(5−p)`, UL `'F'+(p−1)`, LL `'K'+(5−p)`, LR `'P'+(p−1)`.
 */
export function toUniversal(code: ToothCode): string {
  const q = quadrant(code);
  const p = position(code);
  if (isPrimary(code)) {
    switch (q) {
      case 1:
        return universalLetter('A', 5 - p);
      case 2:
        return universalLetter('F', p - 1);
      case 3:
        return universalLetter('K', 5 - p);
      case 4:
        return universalLetter('P', p - 1);
    }
  }
  switch (q) {
    case 1:
      return String(9 - p);
    case 2:
      return String(8 + p);
    case 3:
      return String(25 - p);
    case 4:
      return String(24 + p);
  }
}

/** The inverse of `toUniversal`, built once from it over all 52 codes rather than re-deriving the
 * arithmetic. */
const FDI_BY_UNIVERSAL: ReadonlyMap<string, ToothCode> = new Map(
  [...PERMANENT_CODES, ...PRIMARY_CODES].map((code) => [toUniversal(code), code]),
);

/**
 * Parses user-entered tooth text into the canonical FDI code, or `null` if it doesn't parse.
 * FDI: `'16'`, `'#16'`. Universal: `'3'`, `'#3'` (permanent 1–32), `'A'`/`'a'` (primary letter).
 */
export function parseTooth(text: string, notation: ToothNotation): ToothCode | null {
  const trimmed = text.trim();
  const stripped = trimmed.startsWith('#') ? trimmed.slice(1) : trimmed;
  if (stripped.length === 0) return null;

  if (notation === 'fdi') {
    return isToothCode(stripped) ? stripped : null;
  }
  if (/^\d+$/.test(stripped)) {
    return FDI_BY_UNIVERSAL.get(String(Number(stripped))) ?? null;
  }
  if (/^[A-Za-z]$/.test(stripped)) {
    return FDI_BY_UNIVERSAL.get(stripped.toUpperCase()) ?? null;
  }
  return null;
}

/** FDI: `#16` / `#55`. Universal: `#3` for permanent, bare `A` for primary letters. */
export function toothLabel(code: ToothCode, notation: ToothNotation): string {
  if (notation === 'fdi') return `#${code}`;
  const universal = toUniversal(code);
  return isPrimary(code) ? universal : `#${universal}`;
}

// Primary ⇄ permanent column mapping.

/** Primary → permanent successor, built once (quadrant maps 5–8 onto 1–4, position unchanged). */
const SUCCESSOR_OF: Record<PrimaryToothCode, PermanentToothCode> = Object.fromEntries(
  PRIMARY_CODES.map((code) => [code, `${quadrant(code)}${position(code)}` as PermanentToothCode]),
) as Record<PrimaryToothCode, PermanentToothCode>;

/** Inverse of `SUCCESSOR_OF`; only the 20 permanent codes at positions 1–5 have an entry. */
const PREDECESSOR_OF: Partial<Record<PermanentToothCode, PrimaryToothCode>> = Object.fromEntries(
  PRIMARY_CODES.map((code) => [SUCCESSOR_OF[code], code]),
);

/** A primary tooth's permanent successor (e.g. `54` → `14`). */
export function successorOf(primaryCode: PrimaryToothCode): PermanentToothCode {
  return SUCCESSOR_OF[primaryCode];
}

/** A permanent tooth's primary predecessor, or `null` for molars (positions 6–8), e.g. `14` →
 * `54`, `16` → `null`. */
export function predecessorOf(permanentCode: PermanentToothCode): PrimaryToothCode | null {
  return PREDECESSOR_OF[permanentCode] ?? null;
}

/** The permanent code of the chart column a tooth belongs to: itself if already permanent, its
 * successor if primary. */
export function positionKey(code: ToothCode): ToothCode {
  return isPrimary(code) ? successorOf(code) : code;
}

// Orientation-aware layout.

/** `PERMANENT_CODES` is quadrant-major, position-ascending, 8 per quadrant — slice it rather than
 * rebuild codes. */
function quadrantColumn(base: 1 | 2 | 3 | 4, order: 'desc' | 'asc'): PermanentToothCode[] {
  const ascending = PERMANENT_CODES.slice((base - 1) * 8, base * 8);
  return order === 'desc' ? ascending.reverse() : ascending;
}

/**
 * The upper and lower columns of a chart, as permanent codes, screen left to right: 16 a jaw on
 * the permanent chart, 10 on the primary one.
 * `patient_right_on_left` (textbook, facing the patient): upper `18…11, 21…28`, lower
 * `48…41, 31…38`. `patient_right_on_right`: each row reversed.
 */
export function archColumns(
  orientation: ChartOrientation,
  stage: DentitionStage = 'permanent',
): {
  upper: PermanentToothCode[];
  lower: PermanentToothCode[];
} {
  // The primary chart has five teeth a quadrant: the columns of positions 1–5.
  const shown = (columns: PermanentToothCode[]) =>
    stage === 'primary' ? columns.filter((column) => position(column) <= 5) : columns;
  if (orientation === 'patient_right_on_left') {
    return {
      upper: shown([...quadrantColumn(1, 'desc'), ...quadrantColumn(2, 'asc')]),
      lower: shown([...quadrantColumn(4, 'desc'), ...quadrantColumn(3, 'asc')]),
    };
  }
  return {
    upper: shown([...quadrantColumn(2, 'desc'), ...quadrantColumn(1, 'asc')]),
    lower: shown([...quadrantColumn(3, 'desc'), ...quadrantColumn(4, 'asc')]),
  };
}

/** Upper row left to right, then lower row left to right: the chart's columns, once each. Wrapping
 * past either end (e.g. arrow-key navigation) is the caller's job. */
export function keyboardOrder(
  orientation: ChartOrientation,
  stage: DentitionStage = 'permanent',
): PermanentToothCode[] {
  const { upper, lower } = archColumns(orientation, stage);
  return [...upper, ...lower];
}

/**
 * True when mesial renders on the glyph's left: the tooth sits on the screen's right half (the
 * midline is to its left). That's `UL`/`LL` for `patient_right_on_left`, and `UR`/`LR` for
 * `patient_right_on_right`. The glyph itself is never mirrored — only which side is M vs D.
 */
export function mesialLeft(code: ToothCode, orientation: ChartOrientation): boolean {
  const q = quadrant(code);
  return orientation === 'patient_right_on_left' ? q === 2 || q === 3 : q === 1 || q === 4;
}

/** `[left, buccal, right, centre, lingual]`: left/right are M/D per `mesialLeft`, centre is `I`
 * for anterior teeth (position ≤ 3) and `O` otherwise. */
export function surfaceCells(
  code: ToothCode,
  orientation: ChartOrientation,
): [SurfaceKey, 'B', SurfaceKey, 'O' | 'I', 'L'] {
  const mesialOnLeft = mesialLeft(code, orientation);
  const left: SurfaceKey = mesialOnLeft ? 'M' : 'D';
  const right: SurfaceKey = mesialOnLeft ? 'D' : 'M';
  const centre: 'O' | 'I' = isAnterior(code) ? 'I' : 'O';
  return [left, 'B', right, centre, 'L'];
}

/** Rejects `I` on a posterior tooth and `O` on an anterior one; `M`, `D`, `B`, `L` are always
 * valid. */
export function validSurfaces(code: ToothCode, surfaces: readonly SurfaceKey[]): boolean {
  const anterior = isAnterior(code);
  return surfaces.every((surface) => {
    if (surface === 'I') return anterior;
    if (surface === 'O') return !anterior;
    return true;
  });
}

// Anatomical names (i18n keys, never English text).

const PERMANENT_TOOTH_NAME_KEYS = [
  'centralIncisor',
  'lateralIncisor',
  'canine',
  'firstPremolar',
  'secondPremolar',
  'firstMolar',
  'secondMolar',
  'thirdMolar',
] as const;

const QUADRANT_NAME_KEYS = {
  1: 'upperRight',
  2: 'upperLeft',
  3: 'lowerLeft',
  4: 'lowerRight',
} as const;

/** `'upperRight' | 'upperLeft' | 'lowerLeft' | 'lowerRight'`. */
export type QuadrantNameKey = (typeof QUADRANT_NAME_KEYS)[keyof typeof QUADRANT_NAME_KEYS];
/** The tooth-name i18n keys used by `anatomicalName`. */
export type ToothNameKey = (typeof PERMANENT_TOOTH_NAME_KEYS)[number];

/** Primary teeth have no premolars and stop at the second molar (positions 4–5). */
const PRIMARY_TOOTH_NAME_KEYS = [
  'centralIncisor',
  'lateralIncisor',
  'canine',
  'firstMolar',
  'secondMolar',
] as const satisfies readonly ToothNameKey[];

/** An i18n key plus params — never English text (CLAUDE.md §13 i18n readiness). */
export function anatomicalName(code: ToothCode): {
  key: 'tooth.name' | 'tooth.primaryName';
  params: { quadrant: QuadrantNameKey; tooth: ToothNameKey };
} {
  const q = quadrant(code);
  const p = position(code);
  const primary = isPrimary(code);
  const names = primary ? PRIMARY_TOOTH_NAME_KEYS : PERMANENT_TOOTH_NAME_KEYS;
  const tooth = names[p - 1];
  if (!tooth) throw new Error(`Invalid tooth position for ${code}`);
  return {
    key: primary ? 'tooth.primaryName' : 'tooth.name',
    params: { quadrant: QUADRANT_NAME_KEYS[q], tooth },
  };
}

// Dentition and what actually occupies a chart column.

/** Which dentition occupies a chart column at a position, on a given chart. `permanent`: every
 * position is permanent. `primary`: 1–5 primary; a primary dentition has no positions 6–8, so the
 * primary chart leaves those columns out (`archColumns`). */
export function slotFor(
  stage: DentitionStage,
  positionValue: number,
): 'permanent' | 'primary' | 'not_erupted' {
  if (stage === 'permanent') return 'permanent';
  return positionValue <= 5 ? 'primary' : 'not_erupted';
}

/** The dentition stage that actually applies: an explicit override always wins; otherwise it's
 * derived from age; with no age and no override it falls back to `permanent`. */
export function effectiveDentition(
  ageYears: number | null,
  override: DentitionStage | null,
): { stage: DentitionStage; source: 'auto' | 'override' } {
  if (override) return { stage: override, source: 'override' };
  if (ageYears == null) return { stage: 'permanent', source: 'auto' };
  return { stage: dentitionStage(ageYears), source: 'auto' };
}

/**
 * The tooth a chart shows in a column. `column` is a permanent code: the permanent chart shows it,
 * the primary chart its primary predecessor (positions 1–5; the primary chart has no others).
 */
export function presentTooth(
  column: PermanentToothCode,
  stage: DentitionStage,
): { code: ToothCode; notErupted: boolean } {
  const slot = slotFor(stage, position(column));
  if (slot === 'primary') {
    // `predecessorOf` is total for positions 1–5, the only ones `slotFor` calls primary.
    return { code: predecessorOf(column) ?? column, notErupted: false };
  }
  return { code: column, notErupted: slot === 'not_erupted' };
}
