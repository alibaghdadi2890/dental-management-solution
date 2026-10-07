import type { ChargeUnit, ToothEffect } from '@dcm/contracts';

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
}

export interface DefaultDiagnosis {
  code: string;
  name: string;
  category: string;
  frequent: boolean;
  active: boolean;
}

const service = (
  code: string,
  name: string,
  category: string,
  chargeUnit: ChargeUnit,
  price: string,
  flags: { frequent?: boolean; active?: boolean; toothEffect?: ToothEffect } = {},
): DefaultService => ({
  code,
  name,
  category,
  chargeUnit,
  price,
  frequent: flags.frequent ?? false,
  active: flags.active ?? true,
  toothEffect: flags.toothEffect ?? 'none',
});

const diagnosis = (
  code: string,
  name: string,
  category: string,
  flags: { frequent?: boolean; active?: boolean } = {},
): DefaultDiagnosis => ({
  code,
  name,
  category,
  frequent: flags.frequent ?? false,
  active: flags.active ?? true,
});

/**
 * The template every tenant starts with (C3): the POC's `CATALOG`, with its prices, and the
 * "Frequently used" services of the workspace spec. Seeded rows are ordinary rows afterwards.
 * Service names are the client's own spelling and must not be corrected. Extraction takes the
 * tooth off the chart and implant placement puts an implant on it (feature 7, H2).
 */
export const DEFAULT_SERVICES: readonly DefaultService[] = [
  service('EXT', 'Extraction', 'Surgical', 'per_tooth', '30', {
    frequent: true,
    toothEffect: 'removes',
  }),
  service('CLT', 'Crown lengthening', 'Surgical', 'per_tooth', '15'),
  service('PARO', 'Periodontal treatment', 'Periodontal', 'per_tooth', '30'),
  service('PARX', 'Periodontal treatment / jaw', 'Periodontal', 'per_jaw', '50'),
  service('CMP', 'Composite', 'Restorative', 'per_tooth', '50', { frequent: true }),
  service('CGIC', 'Composite GIC', 'Restorative', 'per_tooth', '80', { frequent: true }),
  service('CBIO', 'Composite Bio', 'Restorative', 'per_tooth', '100'),
  service('ONL', 'Onlay / inlay', 'Prosthetic', 'per_tooth', '250'),
  service('MCC', 'Metal-ceramic crown', 'Prosthetic', 'per_tooth', '250'),
  service('ZIR', 'Zircon crown', 'Prosthetic', 'per_tooth', '350', { frequent: true }),
  service('SCL', 'Scaling & polishing', 'Periodontal', 'per_mouth', '60'),
  service('XRY', 'Periapical X-ray', 'Diagnostic', 'per_tooth', '20', { active: false }),
  // Not in the POC, so after its rows and without a price: the clinic sets its own before
  // using it (feature 7, D7).
  service('IMP', 'Implant placement', 'Surgical', 'per_tooth', '0', { toothEffect: 'implant' }),
];

/** The POC's `DX_CATALOG` and the workspace spec's "Frequently used" diagnoses. */
export const DEFAULT_DIAGNOSES: readonly DefaultDiagnosis[] = [
  diagnosis('DX-CAR', 'Dental caries', 'Caries', { frequent: true }),
  diagnosis('DX-DEEP', 'Deep caries', 'Caries', { frequent: true }),
  diagnosis('DX-SEC', 'Secondary caries', 'Caries'),
  diagnosis('DX-PULP', 'Irreversible pulpitis', 'Pulpal'),
  diagnosis('DX-RPUL', 'Reversible pulpitis', 'Pulpal'),
  diagnosis('DX-NEC', 'Pulp necrosis', 'Pulpal'),
  diagnosis('DX-APX', 'Apical periodontitis', 'Pulpal'),
  diagnosis('DX-FRAC', 'Cracked tooth', 'Structural'),
  diagnosis('DX-ATTR', 'Attrition', 'Structural'),
  diagnosis('DX-GIN', 'Gingivitis', 'Periodontal', { frequent: true }),
  diagnosis('DX-PERIO', 'Chronic periodontitis', 'Periodontal'),
  diagnosis('DX-REC', 'Gingival recession', 'Periodontal'),
  diagnosis('DX-SENS', 'Dentine hypersensitivity', 'Other', { frequent: true }),
  diagnosis('DX-BRUX', 'Bruxism', 'Other', { active: false }),
];
