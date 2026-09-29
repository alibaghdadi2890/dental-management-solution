/**
 * The canonical tooth model for charting (feature 4a). Pure — no I/O, no Nest, no Drizzle — so it
 * runs unmodified in the API, the SPA and the agent tools (CLAUDE.md §4, §11).
 *
 * The canonical stored value is FDI two-digit text (`ToothCode`, e.g. `'16'`, `'55'`). Universal
 * notation, labels and orientation-aware layout are all derived from it; nothing else is stored.
 * Positions are counted outward from the midline (1 central incisor … 8 third molar; primary only
 * goes to 5), which is what lets a primary tooth and its permanent successor share one chart
 * column (`positionKey`).
 */

import { z } from 'zod';
import { dentitionStage, type DentitionStage } from './patient-age.js';

// ---------------------------------------------------------------------------------------------
// Tenant-facing chart preferences (also used by tenant settings and visit contracts, later tasks)
// ---------------------------------------------------------------------------------------------

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

/** A surface set for one tooth: no duplicates, and never more than the 5 surfaces one tooth has
 * (M, D, B, L, and one of O/I — see `surfaceCells`). */
export const surfacesSchema = z
  .array(surfaceKeySchema)
  .max(5)
  .refine((surfaces) => new Set(surfaces).size === surfaces.length, {
    message: 'Duplicate surface',
  });

// ---------------------------------------------------------------------------------------------
// Canonical codes
// ---------------------------------------------------------------------------------------------

/** The canonical stored value: FDI two-digit text, e.g. `'16'`, `'55'`. */
export type ToothCode = string;

function codesForQuadrants(bases: readonly number[], maxPosition: number): ToothCode[] {
  const codes: ToothCode[] = [];
  for (const base of bases) {
    for (let pos = 1; pos <= maxPosition; pos++) {
      codes.push(`${base}${pos}`);
    }
  }
  return codes;
}

/** 11–18, 21–28, 31–38, 41–48. */
export const PERMANENT_CODES: readonly ToothCode[] = codesForQuadrants([1, 2, 3, 4], 8);
/** 51–55, 61–65, 71–75, 81–85. */
export const PRIMARY_CODES: readonly ToothCode[] = codesForQuadrants([5, 6, 7, 8], 5);

const ALL_CODES = new Set<ToothCode>([...PERMANENT_CODES, ...PRIMARY_CODES]);

/** Exactly the 52 canonical FDI codes — nothing else parses as a tooth. */
export const toothCodeSchema: z.ZodType<ToothCode> = z
  .string()
  .refine((value) => ALL_CODES.has(value), { message: 'Not a canonical FDI tooth code' });

// ---------------------------------------------------------------------------------------------
// Core facts about a code
// ---------------------------------------------------------------------------------------------

/** 1 upper-right, 2 upper-left, 3 lower-left, 4 lower-right. Primary quadrants 5–8 map onto the
 * same 1–4 (first-digit mod 4), which is the whole trick behind sharing a chart column. */
export function quadrant(code: ToothCode): 1 | 2 | 3 | 4 {
  const first = Number(code[0]);
  return (((first - 1) % 4) + 1) as 1 | 2 | 3 | 4;
}

/** Second digit: 1 (central incisor, midline) … 8 (third molar); primary only goes to 5. */
export function position(code: ToothCode): number {
  return Number(code[1]);
}

/** A code is primary iff its first digit is 5–8. */
export function isPrimary(code: ToothCode): boolean {
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

/** Inverse of the permanent half of `toUniversal`: universal number 1–32 → FDI code, or `null`. */
function fdiFromUniversalPermanent(n: number): ToothCode | null {
  if (n >= 1 && n <= 8) return `1${9 - n}`;
  if (n >= 9 && n <= 16) return `2${n - 8}`;
  if (n >= 17 && n <= 24) return `3${25 - n}`;
  if (n >= 25 && n <= 32) return `4${n - 24}`;
  return null;
}

/** Inverse of the primary half of `toUniversal`: universal letter A–T → FDI code, or `null`. */
function fdiFromUniversalPrimary(letter: string): ToothCode | null {
  const c = letter.toUpperCase().charCodeAt(0) - 'A'.charCodeAt(0);
  if (c < 0 || c > 19) return null;
  if (c <= 4) return `5${5 - c}`;
  if (c <= 9) return `6${c - 4}`;
  if (c <= 14) return `7${15 - c}`;
  return `8${c - 14}`;
}

/**
 * Parses user-entered tooth text into the canonical FDI code, or `null` if it doesn't parse.
 * FDI: `'16'`, `'#16'`. Universal: `'3'`, `'#3'` (permanent 1–32), `'A'`/`'a'` (primary letter).
 */
export function parseTooth(text: string, notation: ToothNotation): ToothCode | null {
  const trimmed = text.trim();
  const stripped = trimmed.startsWith('#') ? trimmed.slice(1) : trimmed;
  if (stripped.length === 0) return null;

  if (notation === 'fdi') {
    return toothCodeSchema.safeParse(stripped).success ? stripped : null;
  }

  if (/^\d+$/.test(stripped)) {
    return fdiFromUniversalPermanent(Number(stripped));
  }
  if (/^[A-Za-z]$/.test(stripped)) {
    return fdiFromUniversalPrimary(stripped);
  }
  return null;
}

/** FDI: `#16` / `#55`. Universal: `#3` for permanent, bare `A` for primary letters. */
export function toothLabel(code: ToothCode, notation: ToothNotation): string {
  if (notation === 'fdi') return `#${code}`;
  const universal = toUniversal(code);
  return isPrimary(code) ? universal : `#${universal}`;
}

// ---------------------------------------------------------------------------------------------
// Primary ⇄ permanent column mapping
// ---------------------------------------------------------------------------------------------

/** A primary tooth's permanent successor (positions 1–5 only; e.g. `54` → `14`). */
export function successorOf(primaryCode: ToothCode): ToothCode {
  return `${quadrant(primaryCode)}${position(primaryCode)}`;
}

/** A permanent tooth's primary predecessor, or `null` for molars (positions 6–8), e.g. `14` →
 * `54`, `16` → `null`. */
export function predecessorOf(permanentCode: ToothCode): ToothCode | null {
  const p = position(permanentCode);
  if (p > 5) return null;
  return `${quadrant(permanentCode) + 4}${p}`;
}

/** The permanent code of the chart column a tooth belongs to: itself if already permanent, its
 * successor if primary. */
export function positionKey(code: ToothCode): ToothCode {
  return isPrimary(code) ? successorOf(code) : code;
}

// ---------------------------------------------------------------------------------------------
// Orientation-aware layout
// ---------------------------------------------------------------------------------------------

function quadrantColumn(base: number, order: 'desc' | 'asc'): ToothCode[] {
  const positions = order === 'desc' ? [8, 7, 6, 5, 4, 3, 2, 1] : [1, 2, 3, 4, 5, 6, 7, 8];
  return positions.map((p) => `${base}${p}`);
}

/**
 * The 16 upper and 16 lower permanent codes, screen left to right.
 * `patient_right_on_left` (textbook, facing the patient): upper `18…11, 21…28`, lower
 * `48…41, 31…38`. `patient_right_on_right`: each row reversed.
 */
export function archColumns(orientation: ChartOrientation): {
  upper: ToothCode[];
  lower: ToothCode[];
} {
  if (orientation === 'patient_right_on_left') {
    return {
      upper: [...quadrantColumn(1, 'desc'), ...quadrantColumn(2, 'asc')],
      lower: [...quadrantColumn(4, 'desc'), ...quadrantColumn(3, 'asc')],
    };
  }
  return {
    upper: [...quadrantColumn(2, 'desc'), ...quadrantColumn(1, 'asc')],
    lower: [...quadrantColumn(3, 'desc'), ...quadrantColumn(4, 'asc')],
  };
}

/** Upper row left to right, then lower row left to right: 32 unique permanent codes. Wrapping
 * past the ends (e.g. arrow-key navigation) is the caller's concern. */
export function keyboardOrder(orientation: ChartOrientation): ToothCode[] {
  const { upper, lower } = archColumns(orientation);
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

// ---------------------------------------------------------------------------------------------
// Anatomical names (i18n keys, never English text)
// ---------------------------------------------------------------------------------------------

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

const PRIMARY_TOOTH_NAME_KEYS = [
  'centralIncisor',
  'lateralIncisor',
  'canine',
  'firstMolar',
  'secondMolar',
] as const;

const QUADRANT_NAME_KEYS = {
  1: 'upperRight',
  2: 'upperLeft',
  3: 'lowerLeft',
  4: 'lowerRight',
} as const;

/** An i18n key plus params — never English text (CLAUDE.md §13 i18n readiness). */
export function anatomicalName(code: ToothCode): {
  key: 'tooth.name' | 'tooth.primaryName';
  params: { quadrant: string; tooth: string };
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

// ---------------------------------------------------------------------------------------------
// Dentition and what actually occupies a chart column
// ---------------------------------------------------------------------------------------------

/** Which dentition occupies a chart column at a position, for a given stage (POC `slotFor`).
 * `permanent`: every position is permanent. `primary`: 1–5 primary, 6–8 not erupted. `mixed`:
 * 1–2 permanent, 3–5 primary, 6 permanent, 7–8 not erupted. */
export function slotFor(
  stage: DentitionStage,
  positionValue: number,
): 'permanent' | 'primary' | 'not_erupted' {
  if (stage === 'permanent') return 'permanent';
  if (stage === 'primary') return positionValue <= 5 ? 'primary' : 'not_erupted';
  if (positionValue <= 2) return 'permanent';
  if (positionValue <= 5) return 'primary';
  if (positionValue === 6) return 'permanent';
  return 'not_erupted';
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
 * The tooth actually present in a chart column. `column` is a permanent code. An optional
 * per-position `presence` overrides the slot for positions 1–5 (elsewhere it has no effect).
 * Primary slot → the primary predecessor; not-erupted → the permanent code flagged as such;
 * otherwise the permanent code itself.
 */
export function presentTooth(
  column: ToothCode,
  stage: DentitionStage,
  presence?: 'primary' | 'permanent',
): { code: ToothCode; notErupted: boolean } {
  const p = position(column);
  const slot = presence && p <= 5 ? presence : slotFor(stage, p);
  if (slot === 'primary') {
    return { code: predecessorOf(column) ?? column, notErupted: false };
  }
  return { code: column, notErupted: slot === 'not_erupted' };
}
