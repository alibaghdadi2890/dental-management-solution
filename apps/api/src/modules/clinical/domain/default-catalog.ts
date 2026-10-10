import type { ChargeUnit, MarkColor, MarkIcon, ToothEffect } from '@dcm/contracts';

export interface DefaultService {
  code: string;
  name: string;
  category: string;
  chargeUnit: ChargeUnit;
  /** In the tenant's currency. */
  price: string;
  frequent: boolean;
  active: boolean;
  /** What performing it does to the tooth's presence on the chart (feature 7, H2). */
  toothEffect: ToothEffect;
  /** The chart mark (feature 9): every per-tooth service has a colour, the others none. */
  color: MarkColor | null;
  icon: MarkIcon | null;
}

export interface DefaultDiagnosis {
  code: string;
  name: string;
  category: string;
  frequent: boolean;
  active: boolean;
  color: MarkColor;
}

const service = (
  code: string,
  name: string,
  category: string,
  chargeUnit: ChargeUnit,
  price: string,
  flags: {
    frequent?: boolean;
    active?: boolean;
    toothEffect?: ToothEffect;
    color?: MarkColor;
    icon?: MarkIcon;
  } = {},
): DefaultService => ({
  code,
  name,
  category,
  chargeUnit,
  price,
  frequent: flags.frequent ?? false,
  active: flags.active ?? true,
  toothEffect: flags.toothEffect ?? 'none',
  color: flags.color ?? null,
  icon: flags.icon ?? null,
});

const diagnosis = (
  code: string,
  name: string,
  category: string,
  color: MarkColor,
  flags: { frequent?: boolean; active?: boolean } = {},
): DefaultDiagnosis => ({
  code,
  name,
  category,
  color,
  frequent: flags.frequent ?? false,
  active: flags.active ?? true,
});

/**
 * The template every tenant starts with (C3): the POC's `CATALOG`, with its prices, and the
 * "Frequently used" services of the workspace spec. Seeded rows are ordinary rows afterwards.
 * Service names are the client's own spelling and must not be corrected. Extraction takes the
 * tooth off the chart and implant placement puts an implant on it (feature 7, H2). Every service
 * on a tooth and every diagnosis has its chart colour, each a different one, and services an icon
 * where one fits (feature 9).
 */
export const DEFAULT_SERVICES: readonly DefaultService[] = [
  service('EXT', 'Extraction', 'Surgical', 'per_tooth', '30', {
    frequent: true,
    toothEffect: 'removes',
    color: 'red',
    icon: 'extraction',
  }),
  service('CLT', 'Crown lengthening', 'Surgical', 'per_tooth', '15', { color: 'brown' }),
  service('PARO', 'Periodontal treatment', 'Periodontal', 'per_tooth', '30', {
    color: 'teal',
    icon: 'cleaning',
  }),
  service('PARX', 'Periodontal treatment / jaw', 'Periodontal', 'per_jaw', '50'),
  service('CMP', 'Composite', 'Restorative', 'per_tooth', '50', {
    frequent: true,
    color: 'blue',
    icon: 'filling',
  }),
  service('CGIC', 'Composite GIC', 'Restorative', 'per_tooth', '80', {
    frequent: true,
    color: 'sky',
    icon: 'filling',
  }),
  service('CBIO', 'Composite Bio', 'Restorative', 'per_tooth', '100', {
    color: 'cyan',
    icon: 'filling',
  }),
  service('ONL', 'Onlay / inlay', 'Prosthetic', 'per_tooth', '250', {
    color: 'violet',
    icon: 'filling',
  }),
  service('MCC', 'Metal-ceramic crown', 'Prosthetic', 'per_tooth', '250', {
    color: 'amber',
    icon: 'crown',
  }),
  service('ZIR', 'Zircon crown', 'Prosthetic', 'per_tooth', '350', {
    frequent: true,
    color: 'purple',
    icon: 'crown',
  }),
  service('SCL', 'Scaling & polishing', 'Periodontal', 'per_mouth', '60'),
  service('XRY', 'Periapical X-ray', 'Diagnostic', 'per_tooth', '20', {
    active: false,
    color: 'lime',
  }),
  // Not in the POC, so after its rows and without a price: the clinic sets its own before
  // using it (feature 7, D7).
  service('IMP', 'Implant placement', 'Surgical', 'per_tooth', '0', {
    toothEffect: 'implant',
    color: 'green',
    icon: 'implant',
  }),
];

/** The POC's `DX_CATALOG` and the workspace spec's "Frequently used" diagnoses. */
export const DEFAULT_DIAGNOSES: readonly DefaultDiagnosis[] = [
  diagnosis('DX-CAR', 'Dental caries', 'Caries', 'rose', { frequent: true }),
  diagnosis('DX-DEEP', 'Deep caries', 'Caries', 'red', { frequent: true }),
  diagnosis('DX-SEC', 'Secondary caries', 'Caries', 'orange'),
  diagnosis('DX-PULP', 'Irreversible pulpitis', 'Pulpal', 'purple'),
  diagnosis('DX-RPUL', 'Reversible pulpitis', 'Pulpal', 'violet'),
  diagnosis('DX-NEC', 'Pulp necrosis', 'Pulpal', 'brown'),
  diagnosis('DX-APX', 'Apical periodontitis', 'Pulpal', 'magenta'),
  diagnosis('DX-FRAC', 'Cracked tooth', 'Structural', 'amber'),
  diagnosis('DX-ATTR', 'Attrition', 'Structural', 'yellow'),
  diagnosis('DX-GIN', 'Gingivitis', 'Periodontal', 'teal', { frequent: true }),
  diagnosis('DX-PERIO', 'Chronic periodontitis', 'Periodontal', 'green'),
  diagnosis('DX-REC', 'Gingival recession', 'Periodontal', 'cyan'),
  diagnosis('DX-SENS', 'Dentine hypersensitivity', 'Other', 'sky', { frequent: true }),
  diagnosis('DX-BRUX', 'Bruxism', 'Other', 'blue', { active: false }),
];
